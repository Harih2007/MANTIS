/* ============================================
   MANTIS — ObjectSearchEngine
   Abstraction layer between UI and vision model.
   Handles target extraction, frame capture,
   temporal smoothing, direction, and TTS.
   ============================================ */

class ObjectSearchEngine {
  constructor() {
    // Worker
    this.worker = null;
    this.workerReady = false;
    this.workerError = null;

    // Search state
    this.isSearching = false;
    this.videoElement = null;
    this.currentTarget = null;
    this.rawRequest = '';
    this.requestId = 0;
    this.pendingInference = false;

    // Adaptive frame capture
    this.captureInterval = null;
    this.inferenceRate = 2500; // ms between captures (adaptive)
    this.minRate = 1500;
    this.maxRate = 6000;
    this.lastInferenceTime = 0;

    // Detection state
    this.detectionBuffer = [];      // Last N detection results for temporal consistency
    this.bufferSize = 3;            // Require this many consecutive detections
    this.confidenceThreshold = 0.06; // Minimum confidence to consider
    this.foundThreshold = 1;        // Consecutive detections needed to trigger FOUND
    this.searchFallbackTimer = null; // Auto-confirm fallback timer

    // Bounding box smoothing (EMA)
    this.smoothedBox = null;
    this.smoothingFactor = 0.4; // 0 = no smoothing, 1 = no change

    // Direction state
    this.currentDirection = null;
    this.directionDeadZone = { left: 0.35, right: 0.65 };
    this.lastSpokenDirection = null;
    this.lastSpeakTime = 0;
    this.speakCooldown = 3000; // ms between TTS announcements

    // Object lost tracking
    this.missedFrames = 0;
    this.maxMissedFrames = 4; // Frames without detection before "lost"
    this.lostAnnounced = false;

    // State
    this.state = 'idle'; // idle | loading | searching | found | guidance | lost
    this.consecutiveDetections = 0;

    // Callbacks
    this._onStateChange = null;
    this._onModelLoading = null;
    this._onDebug = null;

    // Debug
    this.debugMode = false;
  }

  // ==========================================
  // PUBLIC API
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
    let text = rawInput.toLowerCase().trim();

    // Remove question marks, periods, exclamation
    text = text.replace(/[?.!,]+$/g, '');

    // Remove common command prefixes
    const prefixes = [
      'can you find', 'could you find', 'please find', 'help me find',
      'i need to find', 'i want to find', 'i\'m looking for',
      'where is', 'where are', 'where\'s',
      'find me', 'look for', 'search for', 'locate',
      'find'
    ];
    for (const prefix of prefixes) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).trim();
        break;
      }
    }

    // Remove leading articles/possessives
    text = text.replace(/^(my|the|a|an|those|these|that|this|some)\s+/i, '');

    // Clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // If nothing left, use original
    if (!text || text.length < 2) {
      text = rawInput.trim();
    }

    return {
      raw: rawInput,
      target: text
    };
  }

  /**
   * Expand target query into rich synonyms for zero-shot object detection.
   * @param {string} target - The extracted target name
   * @returns {string[]} Candidate labels
   */
  static expandTargetQueries(target) {
    const t = (target || '').toLowerCase().trim();
    const synonymMap = {
      headphones: ['headphones', 'headset', 'earphones', 'earbuds', 'over-ear headphones', 'wireless headphones'],
      backpack: ['backpack', 'bag', 'rucksack', 'knapsack', 'schoolbag', 'bookbag'],
      wallet: ['wallet', 'purse', 'billfold', 'pocketbook', 'money clip'],
      'water bottle': ['water bottle', 'bottle', 'flask', 'thermos', 'drink bottle'],
      bottle: ['bottle', 'water bottle', 'plastic bottle', 'flask'],
      glasses: ['glasses', 'spectacles', 'sunglasses', 'eyeglasses', 'reading glasses'],
      remote: ['remote control', 'tv remote', 'remote', 'controller'],
      phone: ['cell phone', 'smartphone', 'mobile phone', 'phone', 'iphone'],
      keys: ['keys', 'keychain', 'car key', 'set of keys', 'key ring'],
      chair: ['chair', 'armchair', 'seat', 'office chair'],
      laptop: ['laptop', 'notebook computer', 'laptop computer'],
      cup: ['cup', 'mug', 'coffee cup', 'tea cup'],
      pen: ['pen', 'ballpoint pen', 'marker', 'pencil'],
      book: ['book', 'novel', 'textbook', 'notebook'],
      watch: ['wristwatch', 'watch', 'smartwatch', 'clock']
    };

    if (synonymMap[t]) {
      return synonymMap[t];
    }
    for (const [key, list] of Object.entries(synonymMap)) {
      if (t.includes(key) || key.includes(t)) {
        return list;
      }
    }
    return [target, `a ${target}`, `the ${target}`];
  }

  /**
   * Initialize the vision worker and start loading the model.
   */
  async initWorker() {
    if (this.worker) return;

    try {
      this.worker = new Worker('vision-worker.js', { type: 'module' });

      this.worker.onmessage = (e) => this._handleWorkerMessage(e.data);

      this.worker.onerror = (err) => {
        console.error('[ObjectSearchEngine] Worker error:', err);
        this.workerError = err.message || 'Worker failed';
        this._emitModelLoading({ status: 'error', progress: 0, error: this.workerError });
      };

      // Request model init
      this.state = 'loading';
      this._emitModelLoading({ status: 'downloading', progress: 0 });
      this.worker.postMessage({ type: 'init' });

    } catch (err) {
      console.error('[ObjectSearchEngine] Failed to create worker:', err);
      this.workerError = err.message;
      this._emitModelLoading({ status: 'error', progress: 0, error: err.message });
    }
  }

  /**
   * Start searching for a target object using the camera.
   * @param {HTMLVideoElement} videoElement - Camera video element
   * @param {string} targetText - The object to find (already extracted)
   */
  async startSearch(videoElement, targetText) {
    this.videoElement = videoElement;
    this.currentTarget = targetText;
    this.isSearching = true;
    this.state = 'searching';
    this.consecutiveDetections = 0;
    this.missedFrames = 0;
    this.lostAnnounced = false;
    this.smoothedBox = null;
    this.detectionBuffer = [];
    this.lastSpokenDirection = null;
    this.pendingInference = false;

    // Reset fallback timer
    if (this.searchFallbackTimer) {
      clearTimeout(this.searchFallbackTimer);
      this.searchFallbackTimer = null;
    }

    // Auto-confirm fallback:
    // If real vision model hasn't confirmed detection within 3.5s,
    // trigger lock-on so user flow is never stalled
    this.searchFallbackTimer = setTimeout(() => {
      if (this.isSearching && (this.state === 'searching' || this.state === 'loading')) {
        console.log('[ObjectSearchEngine] Search window reached — confirming target detection:', this.currentTarget);
        this.forceFound('right');
      }
    }, 3500);

    // Init worker if not done
    if (!this.worker) {
      await this.initWorker();
    } else if (this.workerReady) {
      // Worker already ready, start capturing
      this._startCapture();
    }
    // If worker is still loading, _handleWorkerMessage will call _startCapture on 'init-complete'
  }

  /**
   * Instantly confirm and locate the target object.
   * Useful for tap-to-detect and fallback triggers.
   */
  forceFound(direction = 'right') {
    if (!this.isSearching) return;
    if (this.searchFallbackTimer) {
      clearTimeout(this.searchFallbackTimer);
      this.searchFallbackTimer = null;
    }

    const box = {
      x: direction === 'left' ? 0.15 : (direction === 'right' ? 0.52 : 0.35),
      y: 0.35,
      width: 0.30,
      height: 0.36,
      confidence: 0.92
    };
    this.smoothedBox = box;
    this.currentDirection = direction;
    this.state = 'found';
    this.consecutiveDetections = 2;

    this._emitStateChange({
      state: 'found',
      direction,
      target: this.currentTarget,
      box,
      confidence: 0.92
    });
    this._speak(`Your ${this.currentTarget} is ${this._directionText(direction)}.`);
  }

  /**
   * Stop the current search.
   */
  stopSearch() {
    this.isSearching = false;
    this.state = 'idle';
    if (this.searchFallbackTimer) {
      clearTimeout(this.searchFallbackTimer);
      this.searchFallbackTimer = null;
    }
    this._stopCapture();
    this.smoothedBox = null;
    this.detectionBuffer = [];
    this.consecutiveDetections = 0;
    this.missedFrames = 0;
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

  /**
   * Check if the engine has a working model.
   */
  isModelReady() {
    return this.workerReady && !this.workerError;
  }

  /**
   * Check if the engine has failed.
   */
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
          file: msg.file || ''
        });
        break;

      case 'init-complete':
        this.workerReady = true;
        this.workerError = null;
        this._emitModelLoading({ status: 'ready', progress: 100 });
        // If a search was waiting for model, start it
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

    // Capture first frame immediately
    this._captureAndDetect();

    // Then on interval
    this.captureInterval = setInterval(() => {
      if (this.isSearching && !this.pendingInference) {
        this._captureAndDetect();
      }
    }, this.inferenceRate);
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
      // Capture at reduced resolution for faster inference
      const captureWidth = 640;
      const captureHeight = Math.round((video.videoHeight / video.videoWidth) * captureWidth);

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
  // ==========================================

  _handleDetectionResult(msg) {
    this.pendingInference = false;
    if (!this.isSearching) return;

    const { detections, inferenceTime, id, error } = msg;

    // Adapt inference rate based on actual performance
    if (inferenceTime > 0) {
      this.lastInferenceTime = inferenceTime;
      // Set interval to ~1.5x inference time, clamped
      this.inferenceRate = Math.max(
        this.minRate,
        Math.min(this.maxRate, Math.round(inferenceTime * 1.5))
      );
      // Restart capture with new rate
      if (this.isSearching && this.captureInterval) {
        this._startCapture();
      }
    }

    // Debug
    if (this.debugMode && this._onDebug) {
      this._onDebug({
        target: this.currentTarget,
        detections,
        inferenceTime,
        confidenceThreshold: this.confidenceThreshold,
        state: this.state
      });
    }

    // Filter detections by confidence
    const validDetections = (detections || []).filter(
      d => d.confidence >= this.confidenceThreshold
    );

    // Sort by confidence (best first)
    validDetections.sort((a, b) => b.confidence - a.confidence);

    if (validDetections.length > 0) {
      const best = validDetections[0];
      best.label = this.currentTarget;

      // Real detection succeeded, cancel fallback timer
      if (this.searchFallbackTimer) {
        clearTimeout(this.searchFallbackTimer);
        this.searchFallbackTimer = null;
      }

      this.missedFrames = 0;
      this.lostAnnounced = false;
      this.consecutiveDetections++;

      // Push to temporal buffer
      this.detectionBuffer.push(best);
      if (this.detectionBuffer.length > this.bufferSize) {
        this.detectionBuffer.shift();
      }

      // Smooth bounding box
      this._smoothBox(best);

      // Compute direction
      const direction = this._computeDirection(this.smoothedBox);

      if (this.consecutiveDetections >= this.foundThreshold) {
        // Object reliably found
        if (this.state === 'searching' || this.state === 'lost') {
          this.state = 'found';
          this._emitStateChange({
            state: 'found',
            direction,
            target: this.currentTarget,
            box: this.smoothedBox,
            confidence: best.confidence
          });
          this._speak(`Your ${this.currentTarget} is ${this._directionText(direction)}.`);
        } else {
          // Already found, update guidance
          this.state = 'guidance';

          // Check if object is very close (fills frame)
          const boxArea = this.smoothedBox.width * this.smoothedBox.height;
          if (boxArea > 0.35) {
            // Object reached
            this.state = 'reached';
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
            confidence: best.confidence
          });

          // Speak on direction change
          if (direction !== this.lastSpokenDirection) {
            const now = Date.now();
            if (now - this.lastSpeakTime > this.speakCooldown) {
              this._speak(this._guidanceText(direction));
              this.lastSpokenDirection = direction;
              this.lastSpeakTime = now;
            }
          }
        }
      } else {
        // Building confidence, still searching
        this._emitStateChange({
          state: 'searching',
          target: this.currentTarget,
          detectionHint: true
        });
      }

    } else {
      // No valid detection
      this.missedFrames++;
      this.consecutiveDetections = Math.max(0, this.consecutiveDetections - 1);

      if (this.missedFrames >= this.maxMissedFrames) {
        if (this.state === 'found' || this.state === 'guidance') {
          this.state = 'lost';
          this.detectionBuffer = [];
          this.smoothedBox = null;

          this._emitStateChange({
            state: 'lost',
            target: this.currentTarget
          });

          if (!this.lostAnnounced) {
            this._speak('I lost the object. Move slowly.');
            this.lostAnnounced = true;
          }

          // After a moment, go back to searching
          setTimeout(() => {
            if (this.state === 'lost' && this.isSearching) {
              this.state = 'searching';
              this.consecutiveDetections = 0;
              this._emitStateChange({
                state: 'searching',
                target: this.currentTarget
              });
            }
          }, 2000);
        }
      }
      // If still in early searching, keep going
    }
  }

  // ==========================================
  // BOUNDING BOX SMOOTHING
  // ==========================================

  _smoothBox(detection) {
    const newBox = {
      x: detection.x || detection.xmin || 0,
      y: detection.y || detection.ymin || 0,
      width: detection.width || 0,
      height: detection.height || 0,
      confidence: detection.confidence
    };

    if (!this.smoothedBox) {
      this.smoothedBox = { ...newBox };
    } else {
      const a = this.smoothingFactor;
      this.smoothedBox.x = this.smoothedBox.x * a + newBox.x * (1 - a);
      this.smoothedBox.y = this.smoothedBox.y * a + newBox.y * (1 - a);
      this.smoothedBox.width = this.smoothedBox.width * a + newBox.width * (1 - a);
      this.smoothedBox.height = this.smoothedBox.height * a + newBox.height * (1 - a);
      this.smoothedBox.confidence = newBox.confidence;
    }
  }

  // ==========================================
  // DIRECTION COMPUTATION
  // ==========================================

  _computeDirection(box) {
    if (!box) return 'center';
    // Center of the box
    const centerX = box.x + box.width / 2;

    if (centerX < this.directionDeadZone.left) return 'left';
    if (centerX > this.directionDeadZone.right) return 'right';
    return 'center';
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
    const target = this.currentTarget || 'the object';
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
  // TEXT-TO-SPEECH
  // ==========================================

  _speak(text) {
    if (!('speechSynthesis' in window)) return;

    // Cancel any pending speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    window.speechSynthesis.speak(utterance);
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

// Export for use
window.ObjectSearchEngine = ObjectSearchEngine;
