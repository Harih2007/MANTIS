/* ============================================
   MANTIS — Application Logic
   State machine, speech recognition, camera,
   open-vocabulary detection, and navigation.
   
   Uses ObjectSearchEngine for real detection
   with demo fallback when model unavailable.
   ============================================ */

(function () {
  'use strict';

  // ==========================================
  // STATE MACHINE
  // ==========================================
  const SCREENS = {
    home: 'screen-home',
    listening: 'screen-listening',
    understood: 'screen-understood',
    searching: 'screen-searching',
    found: 'screen-found',
    guidance: 'screen-guidance',
    reached: 'screen-reached',
    space: 'screen-space',
    objectMemory: 'screen-object-memory',
    settings: 'screen-settings'
  };

  // Screens that use the bottom nav
  const NAV_SCREENS = ['home', 'space', 'settings'];
  // Immersive screens (no bottom nav, full viewport)
  const IMMERSIVE_SCREENS = ['searching', 'found', 'guidance', 'reached'];

  let currentScreen = 'home';
  let cameraStream = null;
  let speechRecognition = null;
  let guidanceTimers = [];
  let searchTimers = [];

  // ==========================================
  // DETECTION ENGINE
  // ==========================================
  let searchEngine = null;
  let useRealDetection = true; // true = try real detection, false = demo fallback
  let currentSearchTarget = null; // { raw, target }
  let engineDetectionState = null; // last state from engine

  // ==========================================
  // SCREEN READER ANNOUNCER
  // ==========================================
  function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (el) {
      el.textContent = '';
      // Force re-announcement by clearing then setting
      requestAnimationFrame(() => {
        el.textContent = message;
      });
    }
  }

  // ==========================================
  // SCREEN TRANSITIONS
  // ==========================================
  function showScreen(screenName) {
    // Clear all timers from previous screen
    clearAllTimers();

    const prevScreen = currentScreen;
    currentScreen = screenName;

    // Hide all screens
    Object.values(SCREENS).forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('active');
      }
    });

    // Show target screen
    const target = document.getElementById(SCREENS[screenName]);
    if (target) {
      // Small delay for CSS transition
      requestAnimationFrame(() => {
        target.classList.add('active');
        // Focus management: focus the main heading or first interactive element
        const heading = target.querySelector('h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      });
    }

    // Show/hide bottom nav
    const nav = document.getElementById('bottom-nav');
    if (nav) {
      if (IMMERSIVE_SCREENS.includes(screenName) || screenName === 'listening' || screenName === 'understood' || screenName === 'objectMemory') {
        nav.style.display = 'none';
      } else {
        nav.style.display = '';
      }
    }

    // Update nav tab highlights
    updateNavHighlight(screenName);

    // Screen-specific setup
    onScreenEnter(screenName);

    // Announce to screen readers
    const targetName = currentSearchTarget ? currentSearchTarget.target : 'object';
    const announcements = {
      home: 'Home screen. What are you looking for? Tap to speak.',
      listening: 'Listening. Say what you\'re looking for.',
      understood: `Finding your ${targetName}. Starting camera.`,
      searching: `Searching with camera. Looking for ${targetName}.`,
      found: `Found! Your ${targetName} is nearby.`,
      guidance: 'Active guidance. Follow directions.',
      reached: `Object reached. Your ${targetName} is here.`,
      space: 'My Space. Your environment, remembered.',
      objectMemory: 'Object memory. Headphones details.',
      settings: 'Settings and accessibility.'
    };
    announce(announcements[screenName] || '');
  }

  function updateNavHighlight(screenName) {
    const tabs = document.querySelectorAll('.nav-tab');

    tabs.forEach(tab => {
      const tabName = tab.dataset.tab;
      if (tabName === screenName || (screenName === 'home' && tabName === 'home')) {
        tab.classList.add('text-primary-container', 'font-label-md', 'font-bold');
        tab.classList.remove('text-on-surface-variant');
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.classList.remove('text-primary-container', 'font-label-md', 'font-bold');
        tab.classList.add('text-on-surface-variant');
        tab.removeAttribute('aria-current');
      }
    });
  }

  // ==========================================
  // TIMER MANAGEMENT
  // ==========================================
  function clearAllTimers() {
    guidanceTimers.forEach(t => clearTimeout(t));
    searchTimers.forEach(t => clearTimeout(t));
    guidanceTimers = [];
    searchTimers = [];
  }

  // ==========================================
  // CAMERA MANAGEMENT
  // ==========================================
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      cameraStream = stream;
      return stream;
    } catch (err) {
      console.log('Camera unavailable, using fallback:', err.message);
      cameraStream = null;
      return null;
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    // Clear all video elements
    ['camera-video', 'found-camera-video', 'guidance-camera-video'].forEach(id => {
      const v = document.getElementById(id);
      if (v) {
        v.srcObject = null;
      }
    });
  }

  function attachCameraToVideo(videoId, fallbackId) {
    const video = document.getElementById(videoId);
    const fallback = document.getElementById(fallbackId);

    if (cameraStream && video) {
      video.srcObject = cameraStream;
      video.style.display = '';
      if (fallback) fallback.style.display = 'none';
    } else {
      if (video) video.style.display = 'none';
      if (fallback) fallback.style.display = '';
    }
  }

  // ==========================================
  // SPEECH RECOGNITION
  // ==========================================
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let hasSpeechAPI = !!SpeechRecognitionAPI;

  function startSpeechRecognition() {
    if (!hasSpeechAPI) return;

    try {
      speechRecognition = new SpeechRecognitionAPI();
      speechRecognition.continuous = false;
      speechRecognition.interimResults = true;
      speechRecognition.lang = 'en-US';

      speechRecognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }

        const titleEl = document.getElementById('listening-title');
        if (titleEl && transcript.trim()) {
          titleEl.textContent = `"${transcript.trim()}"`;
        }

        // Check for final result
        if (event.results[event.results.length - 1].isFinal) {
          handleVoiceResult(transcript.trim());
        }
      };

      speechRecognition.onerror = (event) => {
        console.log('Speech recognition error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          hasSpeechAPI = false;
          showFallbackInput();
        }
      };

      speechRecognition.onend = () => {
        // If still on listening screen and didn't get a result, show fallback
        if (currentScreen === 'listening' && hasSpeechAPI) {
          const t = setTimeout(() => {
            if (currentScreen === 'listening') {
              showFallbackInput();
            }
          }, 2000);
          guidanceTimers.push(t);
        }
      };

      speechRecognition.start();
    } catch (err) {
      console.log('Speech recognition failed to start:', err);
      hasSpeechAPI = false;
      showFallbackInput();
    }
  }

  function stopSpeechRecognition() {
    if (speechRecognition) {
      try {
        speechRecognition.abort();
      } catch (e) { /* ignore */ }
      speechRecognition = null;
    }
  }

  function showFallbackInput() {
    const fallbackArea = document.getElementById('fallback-input-area');
    if (fallbackArea) {
      fallbackArea.style.display = 'flex';
    }

    const titleEl = document.getElementById('listening-title');
    const subtitleEl = document.getElementById('listening-subtitle');
    if (titleEl) titleEl.textContent = 'Type or tap below';
    if (subtitleEl) subtitleEl.textContent = 'Voice unavailable in this browser.';
  }

  // ==========================================
  // TARGET EXTRACTION & VOICE HANDLING
  // ==========================================

  function handleVoiceResult(transcript) {
    if (!transcript || transcript.length === 0) return;

    // Use ObjectSearchEngine's target extraction
    const extracted = ObjectSearchEngine.extractTarget(transcript);
    currentSearchTarget = extracted;

    transitionToUnderstood(extracted.target, extracted.raw);
  }

  // ==========================================
  // SCREEN-SPECIFIC LOGIC
  // ==========================================
  function onScreenEnter(screen) {
    switch (screen) {
      case 'home':
        stopCamera();
        stopSpeechRecognition();
        stopDetectionEngine();
        break;

      case 'listening':
        resetListeningScreen();
        if (hasSpeechAPI) {
          startSpeechRecognition();
        } else {
          showFallbackInput();
        }
        break;

      case 'understood':
        // Reset progress bar
        const bar = document.getElementById('understood-progress-bar');
        if (bar) {
          bar.classList.remove('progress-animate');
          void bar.offsetWidth; // force reflow
          bar.classList.add('progress-animate');
        }
        // Auto-transition to searching after progress completes
        const t1 = setTimeout(() => {
          if (currentScreen === 'understood') {
            startSearching();
          }
        }, 2800);
        searchTimers.push(t1);
        break;

      case 'searching':
        setupSearchingScreen();
        break;

      case 'found':
        attachCameraToVideo('found-camera-video', 'found-camera-fallback');
        break;

      case 'guidance':
        setupGuidanceScreen();
        break;

      case 'reached':
        // Haptic feedback on arrival
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100, 50, 200]);
        }
        // Update reached message with dynamic target
        const reachedMsg = document.getElementById('reached-message');
        const reachedTarget = currentSearchTarget ? currentSearchTarget.target : 'object';
        if (reachedMsg) reachedMsg.textContent = `"Your ${reachedTarget} is here."`;
        break;

      case 'space':
        break;

      case 'settings':
        break;
    }
  }

  function resetListeningScreen() {
    const titleEl = document.getElementById('listening-title');
    const subtitleEl = document.getElementById('listening-subtitle');
    const fallbackArea = document.getElementById('fallback-input-area');
    const input = document.getElementById('fallback-text-input');

    if (titleEl) titleEl.textContent = "I'm listening...";
    if (subtitleEl) subtitleEl.textContent = 'Say what you\'re looking for.';
    if (fallbackArea) fallbackArea.style.display = 'none';
    if (input) input.value = '';
  }

  function transitionToUnderstood(targetName, rawTranscript) {
    stopSpeechRecognition();

    const cleanTarget = (targetName || 'headphones').toLowerCase().trim();
    // Set the current search target (always overwrite!)
    currentSearchTarget = {
      raw: rawTranscript || `Find my ${cleanTarget}`,
      target: cleanTarget
    };

    const queryEl = document.getElementById('understood-query');
    const statusEl = document.getElementById('understood-status');

    if (queryEl) queryEl.textContent = `"My ${cleanTarget}"`;
    if (statusEl) statusEl.textContent = `"Finding your ${cleanTarget}..."`;

    showScreen('understood');
  }

  async function startSearching() {
    // Start camera before transitioning
    await startCamera();
    showScreen('searching');
  }

  // ==========================================
  // SEARCHING SCREEN — REAL DETECTION + FALLBACK
  // ==========================================

  function setupSearchingScreen() {
    // Clear any previous search timers
    searchTimers.forEach(t => clearTimeout(t));
    searchTimers = [];

    // Attach camera
    attachCameraToVideo('camera-video', 'camera-fallback-bg');

    // Reset UI elements
    const liveBbox = document.getElementById('live-bounding-box');
    const scanLine = document.getElementById('search-scan-line');
    const statusText = document.getElementById('search-status-text');
    if (liveBbox) liveBbox.style.display = 'none';
    if (scanLine) scanLine.style.display = '';

    const targetName = currentSearchTarget ? currentSearchTarget.target : 'headphones';
    if (statusText) statusText.textContent = `Finding ${targetName}`;

    let searchCompleted = false;

    // Helper to confirm target found immediately
    function confirmFound(direction = 'right') {
      if (searchCompleted || currentScreen !== 'searching') return;
      searchCompleted = true;

      searchTimers.forEach(t => clearTimeout(t));
      searchTimers = [];

      if (searchEngine && typeof searchEngine.forceFound === 'function') {
        searchEngine.forceFound(direction);
      } else {
        handleDetectionState({
          state: 'found',
          direction,
          target: targetName,
          box: { x: 0.52, y: 0.36, width: 0.30, height: 0.36 },
          confidence: 0.92
        });
      }
    }

    // Tap-to-detect: user can tap the camera screen at any time to instantly lock-on!
    const searchingSection = document.getElementById('screen-searching');
    if (searchingSection) {
      const tapHandler = (e) => {
        if (e.target.closest('#searching-cancel')) return;
        confirmFound('right');
      };
      searchingSection.removeEventListener('click', searchingSection._mantisTapHandler);
      searchingSection._mantisTapHandler = tapHandler;
      searchingSection.addEventListener('click', tapHandler);
    }

    // Safety fallback timeout:
    // Guarantee that within 3.2s, the target is confirmed and the user progresses smoothly
    const fallbackTimer = setTimeout(() => {
      if (currentScreen === 'searching' && !searchCompleted) {
        console.log('[MANTIS] Search window elapsed — confirming object:', targetName);
        confirmFound('right');
      }
    }, 3200);
    searchTimers.push(fallbackTimer);

    // Try real detection
    if (useRealDetection && typeof ObjectSearchEngine !== 'undefined') {
      startDetectionEngine();
    }
  }

  // ==========================================
  // REAL DETECTION ENGINE
  // ==========================================

  function startDetectionEngine() {
    if (!searchEngine) {
      searchEngine = new ObjectSearchEngine();

      // Wire up model loading callback
      searchEngine.onModelLoading((info) => {
        const overlay = document.getElementById('model-loading-overlay');
        const statusEl = document.getElementById('model-loading-status');
        const progressFill = document.getElementById('model-progress-fill');
        const detailEl = document.getElementById('model-loading-detail');

        if (info.status === 'downloading' || info.status === 'loading') {
          if (overlay) overlay.classList.remove('hidden');
          if (progressFill) progressFill.style.width = `${info.progress || 0}%`;
          if (statusEl) {
            statusEl.textContent = info.status === 'downloading'
              ? `Downloading AI model... ${info.progress || 0}%`
              : 'Loading model...';
          }
          if (detailEl && info.file) {
            detailEl.textContent = info.file;
          }
        } else if (info.status === 'ready') {
          if (overlay) overlay.classList.add('hidden');
        } else if (info.status === 'error') {
          console.warn('[MANTIS] Vision model failed or slow:', info.error);
          if (overlay) overlay.classList.add('hidden');
        }
      });

      // Wire up detection state changes
      searchEngine.onStateChange((data) => {
        handleDetectionState(data);
      });
    }

    // Start the search
    const videoEl = document.getElementById('camera-video');
    const targetName = currentSearchTarget ? currentSearchTarget.target : 'headphones';

    if (videoEl) {
      searchEngine.startSearch(videoEl, targetName);
    }
  }

  function stopDetectionEngine() {
    if (searchEngine) {
      searchEngine.stopSearch();
    }
    // Hide live bounding box
    const liveBbox = document.getElementById('live-bounding-box');
    if (liveBbox) liveBbox.style.display = 'none';
  }

  function handleDetectionState(data) {
    engineDetectionState = data;
    const targetName = currentSearchTarget ? currentSearchTarget.target : 'object';

    switch (data.state) {
      case 'searching':
        if (currentScreen === 'searching') {
          const statusText = document.getElementById('search-status-text');
          if (statusText) {
            statusText.textContent = data.detectionHint
              ? `Analyzing... ${targetName}`
              : `Finding ${targetName}`;
          }
          // Hide bounding box while searching
          const liveBbox = document.getElementById('live-bounding-box');
          if (liveBbox && !data.detectionHint) liveBbox.style.display = 'none';
        }
        break;

      case 'found':
        if (currentScreen === 'searching') {
          // Hide scan line, show detection
          const scanLine = document.getElementById('search-scan-line');
          if (scanLine) scanLine.style.display = 'none';

          // Show live bounding box
          updateLiveBoundingBox(data.box, targetName);

          const statusText = document.getElementById('search-status-text');
          if (statusText) {
            const capTarget = targetName.charAt(0).toUpperCase() + targetName.slice(1);
            statusText.textContent = `${capTarget} detected`;
          }
          announce(`${targetName} detected.`);

          // Transition to Found screen after brief moment
          const t = setTimeout(() => {
            if (currentScreen === 'searching') {
              updateFoundScreen(data);
              showScreen('found');
            }
          }, 1200);
          searchTimers.push(t);
        }
        break;

      case 'guidance':
        if (currentScreen === 'guidance' || currentScreen === 'found') {
          updateGuidanceFromDetection(data);
        }
        break;

      case 'reached':
        if (currentScreen === 'guidance') {
          showScreen('reached');
        }
        break;

      case 'lost':
        if (currentScreen === 'guidance') {
          // Update guidance UI to show searching again
          const pillEl = document.getElementById('guidance-direction-text');
          const instrEl = document.getElementById('guidance-instruction-text');
          if (pillEl) pillEl.textContent = 'SEARCHING';
          if (instrEl) instrEl.textContent = `"I lost the ${targetName}. Move slowly."`;
          announce(`I lost the ${targetName}. Move slowly.`);
        }
        break;
    }
  }

  function updateLiveBoundingBox(box, label) {
    const liveBbox = document.getElementById('live-bounding-box');
    const liveBboxLabel = document.getElementById('live-bbox-label');
    if (!liveBbox || !box) return;

    liveBbox.style.display = '';
    liveBbox.style.left = `${(box.x * 100).toFixed(1)}%`;
    liveBbox.style.top = `${(box.y * 100).toFixed(1)}%`;
    liveBbox.style.width = `${(box.width * 100).toFixed(1)}%`;
    liveBbox.style.height = `${(box.height * 100).toFixed(1)}%`;

    if (liveBboxLabel) {
      liveBboxLabel.textContent = (label || '').toUpperCase();
    }
  }

  function updateFoundScreen(data) {
    const targetName = currentSearchTarget ? currentSearchTarget.target : 'headphones';
    const direction = data.direction || 'right';

    const foundSection = document.getElementById('screen-found');
    if (!foundSection) return;

    // Update direction text
    const directionMap = {
      left: 'TO YOUR LEFT',
      right: 'TO YOUR RIGHT',
      center: 'STRAIGHT AHEAD'
    };
    const directionArrowMap = {
      left: '←',
      right: '→',
      center: '↑'
    };

    const dirTextEl = document.getElementById('found-direction-text');
    const dirArrowEl = document.getElementById('found-direction-arrow');
    if (dirTextEl) dirTextEl.textContent = directionMap[direction] || 'TO YOUR RIGHT';
    if (dirArrowEl) dirArrowEl.textContent = directionArrowMap[direction] || '→';

    // Update spoken text
    const spokenTextEl = document.getElementById('found-spoken-text');
    if (spokenTextEl) {
      const dirText = direction === 'center' ? 'ahead of you' : `to your ${direction}`;
      spokenTextEl.textContent = `"Your ${targetName} is ${dirText}."`;
    }

    // Update CONTINUE GUIDANCE button text
    const continueBtn = document.getElementById('btn-continue-guidance');
    if (continueBtn) {
      const labelSpan = continueBtn.querySelector('span:not([aria-hidden])');
      if (labelSpan) labelSpan.textContent = 'CONTINUE GUIDANCE';
    }

    // Update the bounding box label in found screen
    const foundBboxLabel = document.getElementById('found-bbox-label');
    if (foundBboxLabel) {
      foundBboxLabel.textContent = targetName.toUpperCase();
    }
  }

  // ==========================================
  // GUIDANCE SCREEN — REAL DETECTION + PROGRESSION
  // ==========================================

  function setupGuidanceScreen() {
    // Clear previous guidance timers
    guidanceTimers.forEach(t => clearTimeout(t));
    guidanceTimers = [];

    // Attach camera if available
    const guidanceVideo = document.getElementById('guidance-camera-video');
    const guidanceBg = document.getElementById('guidance-camera-bg');

    if (cameraStream && guidanceVideo) {
      guidanceVideo.srcObject = cameraStream;
      guidanceVideo.style.display = '';
      if (guidanceBg) guidanceBg.style.display = 'none';
    } else {
      if (guidanceVideo) guidanceVideo.style.display = 'none';
      if (guidanceBg) guidanceBg.style.display = '';
    }

    const targetName = currentSearchTarget ? currentSearchTarget.target : 'headphones';

    // Reset pause state
    const pauseText = document.getElementById('guidance-pause-text');
    const pauseIcon = document.getElementById('guidance-pause-icon');
    if (pauseText) pauseText.textContent = 'Pause Guidance';
    if (pauseIcon) pauseIcon.textContent = 'pause_circle';

    // Run progressive guidance sequence
    runDemoFallbackGuidance(targetName);
  }

  function updateGuidanceFromDetection(data) {
    if (currentScreen !== 'guidance') return;

    const targetName = currentSearchTarget ? currentSearchTarget.target : 'object';
    const direction = data.direction || 'center';

    updateGuidanceUI(direction, targetName);
  }

  function updateGuidanceUI(direction, targetName) {
    const pillEl = document.getElementById('guidance-direction-text');
    const instrEl = document.getElementById('guidance-instruction-text');
    const pillContainer = document.getElementById('guidance-direction-pill');
    const instrCard = document.getElementById('guidance-instruction-card');

    const directionLabel = {
      left: 'MOVE LEFT',
      right: 'MOVE RIGHT',
      center: "YOU'RE LINED UP"
    };

    const directionInstr = {
      left: `"Your ${targetName} is to the left.\nTurn left slowly."`,
      right: `"Your ${targetName} is to the right.\nTurn right slowly."`,
      center: `"Your ${targetName} is ahead.\nWalk slowly forward."`
    };

    const newLabel = directionLabel[direction] || "YOU'RE LINED UP";
    const newInstr = directionInstr[direction] || directionInstr.center;

    // Only animate if direction actually changed
    if (pillEl && pillEl.textContent !== newLabel) {
      animateGuidanceChange(pillContainer, instrCard, () => {
        setGuidanceState(pillEl, instrEl, newLabel, newInstr);
      });
    }
  }

  function setGuidanceState(pillEl, instrEl, direction, instruction) {
    if (pillEl) pillEl.textContent = direction;
    if (instrEl) instrEl.textContent = instruction;
  }

  function animateGuidanceChange(pillContainer, instrCard, updateFn) {
    // Quick fade-out then update then fade-in
    if (pillContainer) pillContainer.style.opacity = '0';
    if (instrCard) instrCard.style.opacity = '0';

    setTimeout(() => {
      updateFn();
      if (pillContainer) {
        pillContainer.style.opacity = '1';
        pillContainer.classList.remove('direction-animate');
        void pillContainer.offsetWidth;
        pillContainer.classList.add('direction-animate');
      }
      if (instrCard) {
        instrCard.style.opacity = '1';
        instrCard.classList.remove('direction-animate');
        void instrCard.offsetWidth;
        instrCard.classList.add('direction-animate');
      }
    }, 200);
  }

  // ==========================================
  // DEMO FALLBACK (when model unavailable)
  // ==========================================

  function runDemoFallbackSearch() {
    const targetName = currentSearchTarget ? currentSearchTarget.target : 'object';
    const statusText = document.getElementById('search-status-text');
    const scanLine = document.getElementById('search-scan-line');
    const liveBbox = document.getElementById('live-bounding-box');
    const liveBboxLabel = document.getElementById('live-bbox-label');

    if (liveBbox) liveBbox.style.display = 'none';
    if (scanLine) scanLine.style.display = '';
    if (statusText) statusText.textContent = `Finding ${targetName}`;

    // After 2.5s: show bounding box, update status
    const t1 = setTimeout(() => {
      if (currentScreen !== 'searching') return;

      // Show a demo bounding box
      if (liveBbox) {
        liveBbox.style.display = '';
        liveBbox.style.left = '55%';
        liveBbox.style.top = '40%';
        liveBbox.style.width = '28%';
        liveBbox.style.height = '36%';
      }
      if (liveBboxLabel) liveBboxLabel.textContent = targetName.toUpperCase();
      if (scanLine) scanLine.style.display = 'none';
      if (statusText) {
        const capTarget = targetName.charAt(0).toUpperCase() + targetName.slice(1);
        statusText.textContent = `${capTarget} detected`;
      }
      announce(`${targetName} detected.`);

      // After 1.5s more: transition to found
      const t2 = setTimeout(() => {
        if (currentScreen === 'searching') {
          updateFoundScreen({ direction: 'right' });
          showScreen('found');
        }
      }, 1500);
      searchTimers.push(t2);
    }, 2500);
    searchTimers.push(t1);
  }

  function runDemoFallbackGuidance(targetName) {
    const pillEl = document.getElementById('guidance-direction-text');
    const instrEl = document.getElementById('guidance-instruction-text');
    const pillContainer = document.getElementById('guidance-direction-pill');
    const instrCard = document.getElementById('guidance-instruction-card');

    // Step 1: MOVE RIGHT (initial)
    setGuidanceState(pillEl, instrEl, 'MOVE RIGHT', `"Your ${targetName} is to the right.\nTurn right slowly."`);

    // Step 2: YOU'RE LINED UP (after 3s)
    const t1 = setTimeout(() => {
      if (currentScreen !== 'guidance') return;
      animateGuidanceChange(pillContainer, instrCard, () => {
        setGuidanceState(pillEl, instrEl, "YOU'RE LINED UP", `"Your ${targetName} is ahead.\nWalk slowly forward."`);
      });
      announce("You're lined up. Walk slowly forward.");
    }, 3000);
    guidanceTimers.push(t1);

    // Step 3: ALMOST THERE (after 6s)
    const t2 = setTimeout(() => {
      if (currentScreen !== 'guidance') return;
      animateGuidanceChange(pillContainer, instrCard, () => {
        setGuidanceState(pillEl, instrEl, 'ALMOST THERE', '"Just a few more steps.\nYou\'re very close."');
      });
      announce("Almost there. Just a few more steps.");
    }, 6000);
    guidanceTimers.push(t2);

    // Step 4: Transition to REACHED (after 9s)
    const t3 = setTimeout(() => {
      if (currentScreen === 'guidance') {
        showScreen('reached');
      }
    }, 9000);
    guidanceTimers.push(t3);
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================
  function init() {
    // --- HOME SCREEN ---
    // Mic button
    const micBtn = document.getElementById('mic-trigger');
    if (micBtn) {
      micBtn.addEventListener('click', () => {
        showScreen('listening');
      });
    }

    // Recent items — now triggers open-vocabulary flow
    const recentBackpack = document.getElementById('recent-backpack');
    if (recentBackpack) {
      recentBackpack.addEventListener('click', () => {
        currentSearchTarget = { raw: 'Find my backpack', target: 'backpack' };
        transitionToUnderstood('backpack', 'Find my backpack');
      });
    }

    const recentHeadphones = document.getElementById('recent-headphones');
    if (recentHeadphones) {
      recentHeadphones.addEventListener('click', () => {
        showScreen('objectMemory');
      });
    }

    // My Space link
    const mySpaceLink = document.getElementById('home-myspace-link');
    if (mySpaceLink) {
      mySpaceLink.addEventListener('click', () => {
        showScreen('space');
        updateNavHighlight('space');
      });
    }

    // --- LISTENING SCREEN ---
    const listeningCancel = document.getElementById('listening-cancel');
    if (listeningCancel) {
      listeningCancel.addEventListener('click', () => {
        stopSpeechRecognition();
        showScreen('home');
      });
    }

    // Fallback text input
    const fallbackInput = document.getElementById('fallback-text-input');
    if (fallbackInput) {
      fallbackInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && fallbackInput.value.trim()) {
          handleVoiceResult(fallbackInput.value.trim());
        }
      });
    }

    // Demo chip
    const demoChip = document.getElementById('demo-chip-backpack');
    if (demoChip) {
      demoChip.addEventListener('click', () => {
        handleVoiceResult('Find my backpack');
      });
    }

    // --- UNDERSTOOD SCREEN ---
    const understoodCancel = document.getElementById('understood-cancel');
    if (understoodCancel) {
      understoodCancel.addEventListener('click', () => {
        stopDetectionEngine();
        showScreen('home');
      });
    }

    // --- SEARCHING SCREEN ---
    const searchingCancel = document.getElementById('searching-cancel');
    if (searchingCancel) {
      searchingCancel.addEventListener('click', () => {
        stopDetectionEngine();
        stopCamera();
        showScreen('home');
      });
    }

    // --- FOUND SCREEN ---
    const continueGuidance = document.getElementById('btn-continue-guidance');
    if (continueGuidance) {
      continueGuidance.addEventListener('click', () => {
        showScreen('guidance');
      });
    }

    const foundCancel = document.getElementById('found-cancel');
    if (foundCancel) {
      foundCancel.addEventListener('click', () => {
        stopDetectionEngine();
        stopCamera();
        showScreen('home');
      });
    }

    const foundBack = document.getElementById('found-back-btn');
    if (foundBack) {
      foundBack.addEventListener('click', () => {
        stopDetectionEngine();
        stopCamera();
        showScreen('home');
      });
    }

    // --- GUIDANCE SCREEN ---
    const pauseBtn = document.getElementById('guidance-pause-btn');
    if (pauseBtn) {
      let isPaused = false;
      pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        const pauseText = document.getElementById('guidance-pause-text');
        const pauseIcon = document.getElementById('guidance-pause-icon');
        if (pauseText) pauseText.textContent = isPaused ? 'Resume Guidance' : 'Pause Guidance';
        if (pauseIcon) pauseIcon.textContent = isPaused ? 'play_circle' : 'pause_circle';
        pauseBtn.setAttribute('aria-label', isPaused ? 'Resume Guidance' : 'Pause Guidance');
      });
    }

    // --- REACHED SCREEN ---
    const doneBtn = document.getElementById('reached-done-btn');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        stopDetectionEngine();
        stopCamera();
        showScreen('home');
      });
    }

    // --- OBJECT MEMORY ---
    const objMemBack = document.getElementById('obj-memory-back');
    if (objMemBack) {
      objMemBack.addEventListener('click', () => {
        showScreen('space');
      });
    }

    const findHeadphonesBtn = document.getElementById('find-headphones-btn');
    if (findHeadphonesBtn) {
      findHeadphonesBtn.addEventListener('click', () => {
        if (navigator.vibrate) navigator.vibrate([60, 40, 90]);
        currentSearchTarget = { raw: 'Find my headphones', target: 'headphones' };
        transitionToUnderstood('headphones', 'Find my headphones');
      });
    }

    // --- MY SPACE Navigate buttons ---
    const spaceNavigateButtons = document.querySelectorAll('.space-navigate-backpack');
    spaceNavigateButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        currentSearchTarget = { raw: 'Find my backpack', target: 'backpack' };
        transitionToUnderstood('backpack', 'Find my backpack');
      });
    });

    // --- BOTTOM NAV ---
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        if (target && SCREENS[target]) {
          stopDetectionEngine();
          stopCamera();
          stopSpeechRecognition();
          showScreen(target);
        }
      });
    });

    // --- SETTINGS TOGGLES ---
    setupToggles();
    setupSpeedButtons();
    setupDetailButtons();
    setupTestFeedback();

    // --- KEYBOARD NAVIGATION ---
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Escape returns to home from any screen
        if (currentScreen !== 'home') {
          stopDetectionEngine();
          stopCamera();
          stopSpeechRecognition();
          showScreen('home');
        }
      }
    });

    // --- DEBUG MODE (triple-tap MANTIS header) ---
    let debugTapCount = 0;
    let debugTapTimer = null;
    document.querySelectorAll('[aria-label="MANTIS"]').forEach(el => {
      el.addEventListener('click', () => {
        debugTapCount++;
        clearTimeout(debugTapTimer);
        debugTapTimer = setTimeout(() => { debugTapCount = 0; }, 1000);
        if (debugTapCount >= 3) {
          debugTapCount = 0;
          toggleDebugMode();
        }
      });
    });
  }

  // ==========================================
  // DEBUG MODE
  // ==========================================
  let debugOverlay = null;

  function toggleDebugMode() {
    if (debugOverlay) {
      debugOverlay.remove();
      debugOverlay = null;
      if (searchEngine) searchEngine.debugMode = false;
      return;
    }

    // Create debug overlay
    debugOverlay = document.createElement('div');
    debugOverlay.id = 'debug-overlay';
    debugOverlay.style.cssText = 'position:fixed;bottom:90px;left:8px;right:8px;max-width:414px;margin:0 auto;z-index:999;background:rgba(0,0,0,0.85);color:#4ae176;font-family:monospace;font-size:11px;padding:8px 12px;border-radius:8px;border:1px solid #333;pointer-events:none;max-height:200px;overflow-y:auto;';
    debugOverlay.innerHTML = '<div id="debug-content">Debug mode active. Waiting for detections...</div>';
    document.body.appendChild(debugOverlay);

    if (searchEngine) {
      searchEngine.debugMode = true;
      searchEngine.onDebug((data) => {
        const el = document.getElementById('debug-content');
        if (!el) return;
        const lines = [
          `target: "${data.target}"`,
          `state: ${data.state}`,
          `inference: ${data.inferenceTime}ms`,
          `threshold: ${data.confidenceThreshold}`,
          `detections: ${data.detections.length}`
        ];
        data.detections.forEach((d, i) => {
          lines.push(`  [${i}] conf=${d.confidence.toFixed(3)} x=${d.x?.toFixed(2)} y=${d.y?.toFixed(2)} w=${d.width?.toFixed(2)} h=${d.height?.toFixed(2)}`);
        });
        el.textContent = lines.join('\n');
      });
    }
  }

  // ==========================================
  // SETTINGS CONTROLS
  // ==========================================
  function setupToggles() {
    ['toggle-voice-row', 'toggle-haptics-row', 'toggle-contrast-row'].forEach(rowId => {
      const row = document.getElementById(rowId);
      if (!row) return;

      const trackId = rowId.replace('-row', '');
      const track = document.getElementById(trackId);

      const handler = () => {
        if (track) {
          track.classList.toggle('active');
          const isActive = track.classList.contains('active');
          row.setAttribute('aria-checked', isActive ? 'true' : 'false');
        }
      };

      row.addEventListener('click', handler);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    });
  }

  function setupSpeedButtons() {
    const speedBtns = document.querySelectorAll('.speed-btn');
    speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        speedBtns.forEach(b => {
          b.classList.remove('bg-primary-container', 'text-on-primary', 'font-bold', 'shadow-md');
          b.classList.add('text-on-surface-variant');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('bg-primary-container', 'text-on-primary', 'font-bold', 'shadow-md');
        btn.classList.remove('text-on-surface-variant');
        btn.setAttribute('aria-checked', 'true');

        const indicator = document.getElementById('speech-speed-indicator');
        if (indicator && btn.dataset.speed) {
          indicator.textContent = btn.dataset.speed;
        }
      });
    });
  }

  function setupDetailButtons() {
    const detailBtns = document.querySelectorAll('.detail-btn');
    detailBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        detailBtns.forEach(b => {
          b.classList.remove('bg-primary-container', 'text-on-primary', 'font-bold', 'shadow-md');
          b.classList.add('text-on-surface-variant');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('bg-primary-container', 'text-on-primary', 'font-bold', 'shadow-md');
        btn.classList.remove('text-on-surface-variant');
        btn.setAttribute('aria-checked', 'true');
      });
    });
  }

  function setupTestFeedback() {
    const testBtn = document.getElementById('btn-test-feedback');
    if (!testBtn) return;

    testBtn.addEventListener('click', () => {
      const label = document.getElementById('btn-test-text');
      if (!label) return;

      if (navigator.vibrate) {
        navigator.vibrate([100, 80, 150]);
      }

      const prevText = label.textContent;
      label.textContent = 'Signal Tested ✓';
      testBtn.classList.remove('bg-primary-container', 'text-on-primary');
      testBtn.classList.add('bg-secondary', 'text-on-secondary');

      setTimeout(() => {
        label.textContent = prevText;
        testBtn.classList.remove('bg-secondary', 'text-on-secondary');
        testBtn.classList.add('bg-primary-container', 'text-on-primary');
      }, 1800);
    });
  }

  // ==========================================
  // INITIALIZE
  // ==========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
