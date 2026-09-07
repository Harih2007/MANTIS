/* ============================================
   MANTIS — ObjectSearchEngine
   Real computer-vision search engine powered
   by OWL-ViT and Transformers.js Web Worker.
   Enforces temporal stability, real bounding boxes,
   direction dead-zones with hysteresis, debounced TTS,
   and configurable CV thresholds.
   ============================================ */

class ObjectSearchEngine {
  constructor() {
    // Worker
    this.worker = null;
    this.workerReady = false;
    this.workerError = null;
    // WASM remains the validated default until WebGPU has been benchmarked on
    // the target Android Chrome device. Debug mode can explicitly test WebGPU.
    this.preferredDevice = 'wasm'; // 'wasm' | 'webgpu'
    this.activeDevice = 'wasm';

    // Search state
    this.isSearching = false;
    this.videoElement = null;
    this.currentTarget = null;
    this.rawRequest = '';
    this.requestId = 0;
    this.pendingInference = false;
    this.searchStartTime = 0;
    this.lastFailurePromptTime = 0;

    // Configurable Parameters (CV & Stability)
    // OWL-ViT's useful scores for everyday objects on mobile are often below
    // 0.12. A lower admission threshold is safe only alongside the spatial
    // stability check below; it must never independently trigger FOUND.
    this._confidenceThreshold = 0.08;  // Tunable (0.05, 0.10, 0.15, 0.20, 0.25)
    this._stableDetectionCount = 3;    // Minimum safe number of spatially-consistent frames before FOUND
    this._lostTargetGracePeriod = 4;   // Missed frames before declaring target LOST (~6-8s)
    this._inferenceInterval = 1800;    // Adaptive ms between captures
    this.minRate = 1200;
    this.maxRate = 5000;
    this.lastInferenceTime = 0;

    // Temporal detection tracking
    this.consecutiveDetections = 0;
    this.missedFrames = 0;
    this.lastCandidateBox = null;
    this.lastInferenceError = null;
    this.inferenceFailures = 0;
    this.errorAnnounced = false;
    this.lostAnnounced = false;
    this.state = 'idle'; // idle | loading | searching | found | guidance | reached | lost

    // Bounding box smoothing (Exponential Moving Average)
    this.smoothedBox = null;
    this.smoothingFactor = 0.45; // Weight of existing smoothed state (0 = snap, 1 = freeze)

    // Direction state with dead-band and hysteresis
    this.currentDirection = 'center';
    this.directionDeadZone = { left: 0.35, right: 0.65 };
    this.hysteresisBuffer = 0.04;
    this.lastSpokenDirection = null;
    this.lastSpeakTime = 0;
    this.speakCooldown = 3500; // ms between repeated TTS guidance

    // Callbacks
    this._onStateChange = null;
    this._onModelLoading = null;
    this._onDebug = null;

    // Debug Mode
    this.debugMode = false;
  }

  // ==========================================
  // CONFIGURABLE PARAMETERS ACCESSORS
  // ==========================================

  get confidenceThreshold() {
    return this._confidenceThreshold;
  }
  set confidenceThreshold(val) {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      this._confidenceThreshold = parsed;
      console.log(`[ObjectSearchEngine] CONFIDENCE_THRESHOLD updated to ${this._confidenceThreshold}`);
    }
  }

  get stableDetectionCount() {
    return this._stableDetectionCount;
  }
  set stableDetectionCount(val) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      this._stableDetectionCount = parsed;
      console.log(`[ObjectSearchEngine] STABLE_DETECTION_COUNT updated to ${this._stableDetectionCount}`);
    }
  }

  get lostTargetGracePeriod() {
    return this._lostTargetGracePeriod;
  }
  set lostTargetGracePeriod(val) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      this._lostTargetGracePeriod = parsed;
      console.log(`[ObjectSearchEngine] LOST_TARGET_GRACE_PERIOD updated to ${this._lostTargetGracePeriod}`);
    }
  }

  get inferenceInterval() {
    return this._inferenceInterval;
  }
  set inferenceInterval(val) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 500) {
      this._inferenceInterval = parsed;
    }
  }

  setPreferredDevice(device) {
    if (device === 'wasm' || device === 'webgpu') {
      this.preferredDevice = device;
      if (this.worker) {
        this.worker.postMessage({ type: 'init', device: this.preferredDevice });
      }
    }
  }

  // ==========================================
  // PUBLIC API & CALLBACK REGISTRATION
  // ==========================================

  onStateChange(callback) {
    this._onStateChange = callback;
  }

  onModelLoading(callback) {
    this._onModelLoading = callback;
  }

  onDebug(callback) {
    this._onDebug = callback;
    this.debugMode = true;
  }

  /**
   * Extract a visual search target from natural language.
   * @param {string} rawInput - e.g. "Can you find my black backpack?"
   * @returns {{ raw: string, target: string }}
   */
  static extractTarget(rawInput) {
    let text = (rawInput || '').toLowerCase().trim();

    // Remove punctuation
    text = text.replace(/[?.!,]+$/g, '');

    // Remove common command prefixes
    const prefixes = [
      'can you find', 'could you find', 'please find', 'help me find',
      'i need to find', 'i want to find', 'i\'m looking for', 'im looking for',
      'where is', 'where are', 'where\'s', 'wheres',
      'find me', 'look for', 'search for', 'locate',
      'find', 'detect', 'spot', 'track'
    ];
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).trim();
        break;
      }
    }

    // Remove leading articles / possessives
    text = text.replace(/^(my|the|a|an|those|these|that|this|some)\s+/i, '');
    text = text.replace(/\s+/g, ' ').trim();

    if (!text || text.length < 2) {
      text = (rawInput || '').trim();
    }

    return {
      raw: rawInput,
      target: text
    };
  }

  /**
   * Expand target query into zero-shot prompts and common synonyms.
   * Open-vocabulary: works on ANY target string without a fixed list limit.
   * @param {string} target - The extracted target name
   * @returns {string[]} Candidate labels
   */
  static expandTargetQueries(target) {
    const t = (target || '').toLowerCase().trim();
    if (!t) return ['object'];

    // Known common synonym clusters for everyday objects
    const synonymMap = {
      backpack: ['backpack', 'bag', 'rucksack', 'knapsack', 'schoolbag', 'bookbag'],
      headphones: ['headphones', 'headset', 'earphones', 'over-ear headphones', 'wireless headphones'],
      earbuds: ['earbuds', 'in-ear headphones', 'airpods', 'wireless earbuds'],
      wallet: ['wallet', 'purse', 'billfold', 'pocketbook', 'money clip'],
      'water bottle': ['water bottle', 'bottle', 'flask', 'thermos', 'drink bottle'],
      bottle: ['bottle', 'water bottle', 'plastic bottle', 'drink bottle', 'flask'],
      phone: ['smartphone', 'cell phone', 'mobile phone', 'phone', 'iphone', 'android phone'],
      remote: ['remote control', 'tv remote', 'remote', 'controller'],
      keys: ['keys', 'keychain', 'car key', 'set of keys', 'key ring'],
      glasses: ['glasses', 'spectacles', 'sunglasses', 'eyeglasses', 'reading glasses'],
      laptop: ['laptop', 'notebook computer', 'laptop computer', 'computer'],
      cup: ['cup', 'mug', 'coffee cup', 'tea cup', 'coffee mug'],
      chair: ['chair', 'armchair', 'seat', 'office chair'],
      book: ['book', 'novel', 'textbook', 'notebook', 'paperback']
    };

    // Check exact or partial synonym cluster match
    let candidates = null;
    if (synonymMap[t]) {
      candidates = [...synonymMap[t]];
    } else {
      for (const [key, list] of Object.entries(synonymMap)) {
        if (t.includes(key) || key.includes(t)) {
          candidates = [...list];
          if (!candidates.includes(t)) candidates.unshift(t);
          break;
        }
      }
    }

    // Default open-vocabulary query set for any arbitrary object
    if (!candidates) {
      candidates = [t, `a ${t}`, `the ${t}`];
    }

    return candidates;
  }

  // ==========================================
  // WORKER LIFECYCLE
  // ==========================================

  async initWorker(preferredDevice = null) {
    if (this.worker) return;
    if (preferredDevice) this.preferredDevice = preferredDevice;

    try {
      this.worker = new Worker('vision-worker.js', { type: 'module' });

      this.worker.onmessage = (e) => this._handleWorkerMessage(e.data);

      this.worker.onerror = (err) => {
        console.error('[ObjectSearchEngine] Worker error:', err);
        this.workerError = err.message || 'Worker failed';
        this._emitModelLoading({ status: 'error', progress: 0, error: this.workerError });
      };

      this.state = 'loading';
      this._emitModelLoading({ status: 'downloading', progress: 0 });
      this.worker.postMessage({ type: 'init', device: this.preferredDevice });

    } catch (err) {
      console.error('[ObjectSearchEngine] Failed to create worker:', err);
      this.workerError = err.message;
      this._emitModelLoading({ status: 'error', progress: 0, error: err.message });
    }
  }

  // ==========================================
  // SEARCH CONTROL
  // ==========================================

  /**
   * Start searching for a target object using the camera.
   * ZERO fake timers: will ONLY transition to found upon genuine CV model detection.
   * @param {HTMLVideoElement} videoElement - Camera video element
   * @param {string} targetText - The object to find
   */
  async startSearch(videoElement, targetText) {
    this.videoElement = videoElement;
    this.currentTarget = targetText;
    this.isSearching = true;
    this.state = 'searching';
    this.consecutiveDetections = 0;
    this.missedFrames = 0;
    this.lastCandidateBox = null;
    this.lastInferenceError = null;
    this.inferenceFailures = 0;
    this.errorAnnounced = false;
    this.lostAnnounced = false;
    this.smoothedBox = null;
    this.currentDirection = 'center';
    this.lastSpokenDirection = null;
    this.pendingInference = false;
    this.searchStartTime = Date.now();
    this.lastFailurePromptTime = 0;

    // Initial voice prompt
    this._speak(`Finding your ${this.currentTarget}.`);

    // Emit initial searching state
    this._emitStateChange({
      state: 'searching',
      target: this.currentTarget,
      consecutiveDetections: 0,
      confidence: 0
    });

    // Initialize worker if needed
    if (!this.worker) {
      await this.initWorker();
    } else if (this.workerReady) {
      this._startCapture();
    }
  }

  /**
   * Stop the current search.
   */
  stopSearch() {
    this.isSearching = false;
    this.state = 'idle';
    this._stopCapture();
    this.smoothedBox = null;
    this.consecutiveDetections = 0;
    this.missedFrames = 0;
    this.lastCandidateBox = null;
    this.pendingInference = false;
  }

  /**
   * Clean up all resources.
   */
  dispose() {
    this.stopSearch();
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }
  }

  isModelReady() {
    return this.workerReady && !this.workerError;
  }

  hasError() {
    return !!this.workerError;
  }

  // ==========================================
  // WORKER MESSAGE HANDLING
  // ==========================================

  _handleWorkerMessage(msg) {
    switch (msg.type) {
      case 'init-progress':
        this._emitModelLoading({
          status: msg.status,
          progress: msg.progress || 0,
          file: msg.file || '',
          device: msg.device || this.preferredDevice
        });
        break;

      case 'init-complete':
        this.workerReady = true;
        this.workerError = null;
        this.activeDevice = msg.device || 'wasm';
        this._emitModelLoading({
          status: 'ready',
          progress: 100,
          device: this.activeDevice
        });
        if (this.isSearching) {
          this._startCapture();
        }
        break;

      case 'init-error':
        this.workerError = msg.error;
        this.workerReady = false;
        this._emitModelLoading({ status: 'error', progress: 0, error: msg.error });
        break;

      case 'result':
        this._handleDetectionResult(msg);
        break;
    }
  }

  // ==========================================
  // FRAME CAPTURE
  // ==========================================

  _startCapture() {
    this._stopCapture();
    if (!this.isSearching) return;

    // Capture first frame
    this._captureAndDetect();

    // Loop with adaptive interval
    this.captureInterval = setInterval(() => {
      if (this.isSearching && !this.pendingInference) {
        this._captureAndDetect();
      }
    }, this._inferenceInterval);
  }

  _stopCapture() {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  _captureAndDetect() {
    if (!this.videoElement || !this.workerReady || this.pendingInference) return;

    const video = this.videoElement;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    try {
      // Capture at efficient 640px width for fast mobile inference
      const captureWidth = 640;
      const captureHeight = Math.max(360, Math.round((video.videoHeight / video.videoWidth) * captureWidth));

      const canvas = document.createElement('canvas');
      canvas.width = captureWidth;
      canvas.height = captureHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, captureWidth, captureHeight);
      const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);

      this.requestId++;
      this.pendingInference = true;

      this.worker.postMessage({
        type: 'detect',
        imageData: imageData,
        targets: ObjectSearchEngine.expandTargetQueries(this.currentTarget),
        id: this.requestId
      });

    } catch (err) {
      console.error('[ObjectSearchEngine] Frame capture error:', err);
      this.pendingInference = false;
    }
  }

  // ==========================================
  // DETECTION RESULT PROCESSING
  // Genuine CV-driven logic only!
  // ==========================================

  _handleDetectionResult(msg) {
    this.pendingInference = false;
    if (!this.isSearching) return;

    const { detections, inferenceTime, device, id, error } = msg;
    if (device) this.activeDevice = device;

    // A worker failure must never masquerade as a negative model result.
    // Keeping the user in SEARCHING is correct, but exposing it to the
    // developer HUD makes a browser/runtime fault diagnosable on-device.
    if (error) {
      this.lastInferenceError = error;
      this.inferenceFailures++;
      if (this._onDebug) {
        this._onDebug({
          target: this.currentTarget,
          detections: [],
          bestDetection: null,
          confidenceThreshold: this._confidenceThreshold,
          stableDetectionCount: this._stableDetectionCount,
          consecutiveDetections: this.consecutiveDetections,
          missedFrames: this.missedFrames,
          state: this.state,
          direction: this.currentDirection,
          smoothedBox: this.smoothedBox,
          inferenceTime: inferenceTime || 0,
          inferenceFPS: '0',
          device: this.activeDevice,
          error,
          inferenceFailures: this.inferenceFailures
        });
      }
      this._emitStateChange({
        state: 'vision-error',
        target: this.currentTarget,
        error,
        inferenceFailures: this.inferenceFailures
      });
      if (!this.errorAnnounced) {
        this._speak('Vision needs a moment. Keep the phone steady and try again.');
        this.errorAnnounced = true;
      }
      return;
    }

    this.lastInferenceError = null;
    this.inferenceFailures = 0;

    // Adapt inference rate to device capability
    if (inferenceTime > 0) {
      this.lastInferenceTime = inferenceTime;
      const adaptedRate = Math.max(
        this.minRate,
        Math.min(this.maxRate, Math.round(inferenceTime * 1.35))
      );
      if (Math.abs(adaptedRate - this._inferenceInterval) > 300) {
        this._inferenceInterval = adaptedRate;
        if (this.isSearching && this.captureInterval) {
          this._startCapture();
        }
      }
    }

    // Filter detections by the active confidence threshold
    const validDetections = (detections || []).filter(
      d => d.confidence >= this._confidenceThreshold
    );
    validDetections.sort((a, b) => b.confidence - a.confidence);

    const best = validDetections.length > 0 ? validDetections[0] : null;

    // Send rich metrics to debug subscriber
    if (this._onDebug) {
      this._onDebug({
        target: this.currentTarget,
        detections: detections || [],
        bestDetection: best || (detections && detections[0]) || null,
        confidenceThreshold: this._confidenceThreshold,
        stableDetectionCount: this._stableDetectionCount,
        consecutiveDetections: this.consecutiveDetections,
        missedFrames: this.missedFrames,
        state: this.state,
        direction: this.currentDirection,
        smoothedBox: this.smoothedBox,
        inferenceTime: inferenceTime || 0,
        inferenceFPS: inferenceTime > 0 ? (1000 / inferenceTime).toFixed(1) : '0',
        device: this.activeDevice
      });
    }

    // ----------------------------------------------------
    // BRANCH A: Valid detection above threshold
    // ----------------------------------------------------
    if (best) {
      // A score alone is not stability. Require the candidate to remain in
      // roughly the same place so unrelated noisy boxes cannot accumulate.
      const candidateBox = this._normaliseBox(best);
      const sameCandidate = !this.lastCandidateBox ||
        this._intersectionOverUnion(candidateBox, this.lastCandidateBox) >= 0.25;
      this.missedFrames = 0;
      this.lostAnnounced = false;
      this.consecutiveDetections = sameCandidate ? this.consecutiveDetections + 1 : 1;
      this.lastCandidateBox = candidateBox;

      // Smooth bounding box
      this._smoothBox(best);

      // Compute direction with dead-zone and hysteresis
      const direction = this._computeDirection(this.smoothedBox);

      // Check if detection has reached stability requirement
      if (this.consecutiveDetections >= this._stableDetectionCount) {
        // TRANSITION: Candidate -> FOUND
        if (this.state === 'searching' || this.state === 'lost') {
          this.state = 'found';
          this._vibrate([80, 50, 100]);
          this._emitStateChange({
            state: 'found',
            direction,
            target: this.currentTarget,
            box: this.smoothedBox,
            confidence: best.confidence,
            consecutiveDetections: this.consecutiveDetections
          });
          this._speak(`I found your ${this.currentTarget}. It's ${this._directionText(direction)}.`);

        } else {
          // ACTIVE GUIDANCE
          this.state = 'guidance';

          // Check if object fills frame (Reached)
          const boxArea = this.smoothedBox.width * this.smoothedBox.height;
          if (boxArea > 0.35) {
            this.state = 'reached';
            this._vibrate([100, 50, 100, 50, 200]);
            this._emitStateChange({
              state: 'reached',
              target: this.currentTarget,
              box: this.smoothedBox
            });
            this._speak(`Your ${this.currentTarget} is here.`);
            this.stopSearch();
            return;
          }

          this._emitStateChange({
            state: 'guidance',
            direction,
            target: this.currentTarget,
            box: this.smoothedBox,
            confidence: best.confidence,
            consecutiveDetections: this.consecutiveDetections
          });

          // Debounced voice announcement on meaningful direction change
          if (direction !== this.lastSpokenDirection) {
            const now = Date.now();
            if (now - this.lastSpeakTime > this.speakCooldown) {
              this._speak(this._guidanceText(direction));
              this.lastSpokenDirection = direction;
              this.lastSpeakTime = now;
              this._vibrate([40]);
            }
          }
        }

      } else {
        // CANDIDATE PHASE (e.g. frame 1 or 2 of 3)
        // Remains strictly in searching, but hints live box to UI if enabled
        this._emitStateChange({
          state: 'searching',
          target: this.currentTarget,
          candidateCount: this.consecutiveDetections,
          stableTarget: this._stableDetectionCount,
          box: this.smoothedBox,
          confidence: best.confidence,
          isCandidate: true
        });
      }

    // ----------------------------------------------------
    // BRANCH B: No detection above threshold
    // ----------------------------------------------------
    } else {
      this.missedFrames++;
      // Decay candidate count smoothly
      this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);
      this.lastCandidateBox = null;

      // If object was previously found or in guidance:
      if (this.state === 'found' || this.state === 'guidance') {
        // Check grace period
        if (this.missedFrames > this._lostTargetGracePeriod) {
          this.state = 'lost';
          this.smoothedBox = null;

          this._emitStateChange({
            state: 'lost',
            target: this.currentTarget
          });

          if (!this.lostAnnounced) {
            this._speak(`I lost the ${this.currentTarget}. Move slowly.`);
            this._vibrate([50, 80, 50]);
            this.lostAnnounced = true;
          }

          // Return to searching after calm pause
          setTimeout(() => {
            if (this.state === 'lost' && this.isSearching) {
              this.state = 'searching';
              this.consecutiveDetections = 0;
              this.smoothedBox = null;
              this._emitStateChange({
                state: 'searching',
                target: this.currentTarget
              });
            }
          }, 2000);
        }

      } else if (this.state === 'searching') {
        // Check sustained search failure prompt (>16s without candidate)
        const elapsed = Date.now() - this.searchStartTime;
        const sinceLastPrompt = Date.now() - this.lastFailurePromptTime;

        if (elapsed > 16000 && sinceLastPrompt > 20000) {
          this._speak("I'm having trouble finding it. Move the phone slowly.");
          this.lastFailurePromptTime = Date.now();
        }

        this._emitStateChange({
          state: 'searching',
          target: this.currentTarget,
          candidateCount: 0,
          box: null
        });
      }
    }
  }

  // ==========================================
  // BOUNDING BOX SMOOTHING (EMA)
  // ==========================================

  _normaliseBox(detection) {
    const x = detection.x ?? detection.xmin ?? 0;
    const y = detection.y ?? detection.ymin ?? 0;
    const width = detection.width ?? ((detection.xmax ?? 0) - x);
    const height = detection.height ?? ((detection.ymax ?? 0) - y);
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Math.max(0.01, Math.min(1, width)),
      height: Math.max(0.01, Math.min(1, height))
    };
  }

  _intersectionOverUnion(a, b) {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = a.width * a.height + b.width * b.height - intersection;
    return union > 0 ? intersection / union : 0;
  }

  _smoothBox(detection) {
    const normalised = this._normaliseBox(detection);
    const newBox = {
      ...normalised,
      confidence: detection.confidence || 0
    };

    if (!this.smoothedBox) {
      this.smoothedBox = { ...newBox };
    } else {
      const a = this.smoothingFactor;
      this.smoothedBox.x = Math.max(0, Math.min(1, this.smoothedBox.x * a + newBox.x * (1 - a)));
      this.smoothedBox.y = Math.max(0, Math.min(1, this.smoothedBox.y * a + newBox.y * (1 - a)));
      this.smoothedBox.width = Math.max(0.01, Math.min(1, this.smoothedBox.width * a + newBox.width * (1 - a)));
      this.smoothedBox.height = Math.max(0.01, Math.min(1, this.smoothedBox.height * a + newBox.height * (1 - a)));
      this.smoothedBox.confidence = newBox.confidence;
    }
  }

  // ==========================================
  // DIRECTION WITH DEAD-ZONE & HYSTERESIS
  // ==========================================

  _computeDirection(box) {
    if (!box) return this.currentDirection || 'center';

    const centerX = box.x + box.width / 2;
    const dz = this.directionDeadZone;
    const h = this.hysteresisBuffer;

    let newDirection = this.currentDirection || 'center';

    if (this.currentDirection === 'center') {
      if (centerX < dz.left - h) {
        newDirection = 'left';
      } else if (centerX > dz.right + h) {
        newDirection = 'right';
      } else {
        newDirection = 'center';
      }
    } else if (this.currentDirection === 'left') {
      if (centerX > dz.left + h) {
        newDirection = (centerX > dz.right + h) ? 'right' : 'center';
      } else {
        newDirection = 'left';
      }
    } else if (this.currentDirection === 'right') {
      if (centerX < dz.right - h) {
        newDirection = (centerX < dz.left - h) ? 'left' : 'center';
      } else {
        newDirection = 'right';
      }
    } else {
      if (centerX < dz.left) newDirection = 'left';
      else if (centerX > dz.right) newDirection = 'right';
      else newDirection = 'center';
    }

    this.currentDirection = newDirection;
    return newDirection;
  }

  _directionText(direction) {
    switch (direction) {
      case 'left': return 'to your left';
      case 'right': return 'to your right';
      case 'center': return 'ahead';
      default: return 'ahead';
    }
  }

  _guidanceText(direction) {
    const target = this.currentTarget || 'object';
    switch (direction) {
      case 'left':
        return `Your ${target} is to your left. Turn left slowly.`;
      case 'right':
        return `Your ${target} is to your right. Turn right slowly.`;
      case 'center':
        return `You're lined up. Your ${target} is ahead. Walk slowly forward.`;
      default:
        return `Your ${target} is ahead.`;
    }
  }

  // ==========================================
  // SPEECH & HAPTICS
  // ==========================================

  _speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[ObjectSearchEngine] Speech failed:', err);
    }
  }

  _vibrate(pattern) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (err) {
        // Ignore on platforms without haptic vibration support
      }
    }
  }

  // ==========================================
  // EVENT EMITTERS
  // ==========================================

  _emitStateChange(data) {
    if (this._onStateChange) {
      this._onStateChange(data);
    }
  }

  _emitModelLoading(data) {
    if (this._onModelLoading) {
      this._onModelLoading(data);
    }
  }
}

// Export for browser global
window.ObjectSearchEngine = ObjectSearchEngine;
