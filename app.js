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
  // SEARCHING SCREEN — REAL DETECTION
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

    // Start real detection engine ONLY. Zero fake timers. Zero tap-to-detect.
    // If target is not detected: remain in SEARCHING.
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
          if (detailEl) {
            detailEl.textContent = info.file ? `${info.file} (${info.device || 'WASM'})` : `Runtime: ${info.device || 'WASM'}`;
          }
        } else if (info.status === 'ready') {
          if (overlay) overlay.classList.add('hidden');
        } else if (info.status === 'error') {
          console.warn('[MANTIS] Vision model failed:', info.error);
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
          const scanLine = document.getElementById('search-scan-line');
          if (statusText) {
            if (data.isCandidate && data.candidateCount > 0) {
              const capTarget = targetName.charAt(0).toUpperCase() + targetName.slice(1);
              statusText.textContent = `Analyzing ${capTarget} (${data.candidateCount}/${data.stableTarget || 3})`;
            } else {
              statusText.textContent = `Finding ${targetName}`;
            }
          }
          if (scanLine) scanLine.style.display = '';

          // Show candidate bounding box if candidate frame
          if (data.box && data.isCandidate) {
            updateLiveBoundingBox(data.box, targetName);
          } else {
            const liveBbox = document.getElementById('live-bounding-box');
            if (liveBbox) liveBbox.style.display = 'none';
          }
        }
        break;

      case 'found':
        if (currentScreen === 'searching') {
          // Hide scan line, show detection
          const scanLine = document.getElementById('search-scan-line');
          if (scanLine) scanLine.style.display = 'none';

          // Show live bounding box with real model coordinates
          updateLiveBoundingBox(data.box, targetName);

          const statusText = document.getElementById('search-status-text');
          if (statusText) {
            const capTarget = targetName.charAt(0).toUpperCase() + targetName.slice(1);
            statusText.textContent = `${capTarget} detected`;
          }
          announce(`${targetName} detected.`);

          // Transition to Found screen after brief moment to show lock-on
          const t = setTimeout(() => {
            if (currentScreen === 'searching') {
              updateFoundScreen(data);
              showScreen('found');
            }
          }, 1000);
          searchTimers.push(t);
        }
        break;

      case 'guidance':
        if (currentScreen === 'guidance' || currentScreen === 'found') {
          updateGuidanceFromDetection(data);
        }
        break;

      case 'reached':
        if (currentScreen === 'guidance' || currentScreen === 'found') {
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
        } else if (currentScreen === 'searching') {
          const liveBbox = document.getElementById('live-bounding-box');
          if (liveBbox) liveBbox.style.display = 'none';
          const scanLine = document.getElementById('search-scan-line');
          if (scanLine) scanLine.style.display = '';
          const statusText = document.getElementById('search-status-text');
          if (statusText) statusText.textContent = `Finding ${targetName}`;
        }
        break;

      case 'vision-error':
        // Keep the accessible experience calm and non-technical. Detailed
        // worker diagnostics stay exclusively in the developer HUD.
        if (currentScreen === 'searching') {
          const statusText = document.getElementById('search-status-text');
          const scanLine = document.getElementById('search-scan-line');
          if (statusText) statusText.textContent = `Still looking for ${targetName}`;
          if (scanLine) scanLine.style.display = '';
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

    // Update bounding box container with REAL model coordinates
    const foundBboxContainer = document.getElementById('found-bbox-container');
    if (foundBboxContainer && data.box) {
      foundBboxContainer.style.left = `${(data.box.x * 100).toFixed(1)}%`;
      foundBboxContainer.style.top = `${(data.box.y * 100).toFixed(1)}%`;
      foundBboxContainer.style.width = `${(data.box.width * 100).toFixed(1)}%`;
      foundBboxContainer.style.height = `${(data.box.height * 100).toFixed(1)}%`;
      foundBboxContainer.style.right = 'auto';
      foundBboxContainer.style.bottom = 'auto';
      foundBboxContainer.style.display = '';
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

    // Set initial guidance state from real detection engine state
    const initialDir = (engineDetectionState && engineDetectionState.direction) || 'center';
    updateGuidanceUI(initialDir, targetName);
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

    // --- LOCAL ITEM REFERENCE ---
    // Reuse the approved Object Memory action without adding a new screen.
    // The reference stays on this device; it is not uploaded anywhere.
    const updateLocationBtn = document.querySelector('#screen-object-memory button[aria-label="Update Location"]');
    if (updateLocationBtn) {
      updateLocationBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              localStorage.setItem('mantis-reference-headphones', JSON.stringify({
                image: reader.result,
                name: 'headphones',
                savedAt: new Date().toISOString()
              }));
              const image = document.querySelector('#screen-object-memory img');
              if (image) {
                image.src = reader.result;
                image.alt = 'Saved reference photo of your headphones';
              }
              announce('Reference photo saved on this device.');
              if (navigator.vibrate) navigator.vibrate([60, 40, 90]);
            } catch (error) {
              console.warn('[MANTIS] Could not save reference photo:', error);
              announce('Reference photo could not be saved.');
            }
          };
          reader.readAsDataURL(file);
        }, { once: true });
        input.click();
      });
    }

    // Restore a previously saved local reference when opening the screen.
    try {
      const savedReference = JSON.parse(localStorage.getItem('mantis-reference-headphones') || 'null');
      const image = document.querySelector('#screen-object-memory img');
      if (savedReference && savedReference.image && image) {
        image.src = savedReference.image;
        image.alt = 'Saved reference photo of your headphones';
      }
    } catch (error) {
      console.warn('[MANTIS] Could not restore reference photo:', error);
    }

    // --- MY SPACE Navigate buttons ---
    const spaceNavigateHeadphones = document.querySelectorAll('.space-navigate-headphones');
    spaceNavigateHeadphones.forEach(btn => {
      btn.addEventListener('click', () => {
        showScreen('objectMemory');
      });
    });

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
      // Toggle developer debug overlay: Ctrl+Shift+D or backtick
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') || (e.key === '`' && e.target.tagName !== 'INPUT')) {
        e.preventDefault();
        toggleDebugMode();
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

    // Auto-open debug mode if query param present (e.g. ?debug=1 or ?dev=1)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('debug') || urlParams.has('dev')) {
        setTimeout(() => toggleDebugMode(), 500);
      }
    } catch (e) {}
  }

  // ==========================================
  // DEVELOPER-ONLY DEBUG HUD
  // Never visible in normal MANTIS mode.
  // ==========================================
  let debugOverlay = null;

  function toggleDebugMode() {
    if (debugOverlay) {
      debugOverlay.remove();
      debugOverlay = null;
      if (searchEngine) searchEngine.debugMode = false;
      return;
    }

    // Ensure searchEngine exists
    if (!searchEngine && typeof ObjectSearchEngine !== 'undefined') {
      searchEngine = new ObjectSearchEngine();
      searchEngine.onStateChange((data) => handleDetectionState(data));
    }

    // Create debug overlay container
    debugOverlay = document.createElement('div');
    debugOverlay.id = 'mantis-debug-hud';
    debugOverlay.style.cssText = `
      position: fixed;
      top: 12px;
      left: 8px;
      right: 8px;
      max-width: 414px;
      margin: 0 auto;
      z-index: 99999;
      background: rgba(12, 14, 16, 0.94);
      color: #e2e2e5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(251, 191, 36, 0.35);
      box-shadow: 0 10px 30px rgba(0,0,0,0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      pointer-events: auto;
      max-height: 85vh;
      overflow-y: auto;
    `;

    debugOverlay.innerHTML = `
      <!-- Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#4ae176;"></span>
          <strong style="color:#fbbf24; font-size:11px; letter-spacing:0.05em;">MANTIS CV VALIDATION HUD</strong>
          <span id="dbg-device-badge" style="padding:1px 5px; border-radius:4px; background:#1e2022; color:#d3c5ac; font-size:9px; font-weight:700;">${(searchEngine && searchEngine.activeDevice ? searchEngine.activeDevice.toUpperCase() : 'WASM')}</span>
        </div>
        <button id="dbg-close-btn" style="background:transparent; border:none; color:#9c8f79; font-size:14px; cursor:pointer; padding:0 4px; line-height:1;">✕</button>
      </div>

      <!-- Live CV Metrics Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:8px; background:rgba(0,0,0,0.4); padding:8px; border-radius:8px;">
        <div>
          <span style="color:#9c8f79;">Target:</span> <span id="dbg-target" style="color:#ffe1a7; font-weight:700;">-</span>
        </div>
        <div>
          <span style="color:#9c8f79;">Detected:</span> <span id="dbg-detected" style="color:#4ae176; font-weight:700;">-</span>
        </div>
        <div>
          <span style="color:#9c8f79;">Direction:</span> <span id="dbg-direction" style="color:#fbbf24; font-weight:700;">-</span>
        </div>
        <div>
          <span style="color:#9c8f79;">Stability:</span> <span id="dbg-stability" style="color:#e2e2e5; font-weight:700;">0 / 3</span>
        </div>
        <div>
          <span style="color:#9c8f79;">Latency:</span> <span id="dbg-latency" style="color:#e2e2e5;">0 ms</span>
        </div>
        <div>
          <span style="color:#9c8f79;">Rate:</span> <span id="dbg-fps" style="color:#e2e2e5;">0 inf/s</span>
        </div>
        <div style="grid-column: span 2;">
          <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
            <span style="color:#9c8f79;">Confidence:</span>
            <span id="dbg-conf-val" style="color:#4ae176; font-weight:700;">0.000</span>
          </div>
          <div style="width:100%; height:5px; background:#282a2c; border-radius:3px; overflow:hidden;">
            <div id="dbg-conf-bar" style="width:0%; height:100%; background:#4ae176; transition:width 0.2s;"></div>
          </div>
        </div>
        <div style="grid-column: span 2; font-size:10px; color:#9c8f79;">
          Box: <span id="dbg-box" style="color:#d3c5ac;">[none]</span>
        </div>
        <div style="grid-column: span 2; font-size:10px; color:#ffb4ab; display:none;" id="dbg-error-row">
          Worker: <span id="dbg-error">[none]</span>
        </div>
      </div>

      <!-- Threshold Testing Controls -->
      <div style="margin-bottom:8px; background:rgba(0,0,0,0.3); padding:8px; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <span style="color:#9c8f79; font-size:10px; font-weight:700; text-transform:uppercase;">Confidence Threshold Test</span>
          <span id="dbg-current-thresh" style="color:#fbbf24; font-weight:700;">${searchEngine ? searchEngine.confidenceThreshold.toFixed(2) : '0.12'}</span>
        </div>
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          ${[0.05, 0.10, 0.15, 0.20, 0.25].map(th => `
            <button class="dbg-th-btn" data-thresh="${th}" style="
              flex: 1;
              min-width: 48px;
              padding: 4px 6px;
              border-radius: 6px;
              border: 1px solid rgba(255,255,255,0.15);
              background: ${(searchEngine && Math.abs(searchEngine.confidenceThreshold - th) < 0.01) ? '#fbbf24' : '#1e2022'};
              color: ${(searchEngine && Math.abs(searchEngine.confidenceThreshold - th) < 0.01) ? '#402d00' : '#e2e2e5'};
              font-weight: 700;
              font-size: 10px;
              cursor: pointer;
            ">${th.toFixed(2)}</button>
          `).join('')}
        </div>
      </div>

      <!-- Stability Count Controls -->
      <div style="margin-bottom:8px; background:rgba(0,0,0,0.3); padding:8px; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <span style="color:#9c8f79; font-size:10px; font-weight:700; text-transform:uppercase;">Consecutive Cycles (Stability)</span>
          <span id="dbg-current-stable-count" style="color:#fbbf24; font-weight:700;">${searchEngine ? searchEngine.stableDetectionCount : 3} frames</span>
        </div>
        <div style="display:flex; gap:4px;">
          ${[2, 3, 4, 5].map(cnt => `
            <button class="dbg-sc-btn" data-count="${cnt}" style="
              flex: 1;
              padding: 4px 6px;
              border-radius: 6px;
              border: 1px solid rgba(255,255,255,0.15);
              background: ${(searchEngine && searchEngine.stableDetectionCount === cnt) ? '#fbbf24' : '#1e2022'};
              color: ${(searchEngine && searchEngine.stableDetectionCount === cnt) ? '#402d00' : '#e2e2e5'};
              font-weight: 700;
              font-size: 10px;
              cursor: pointer;
            ">${cnt} cycles</button>
          `).join('')}
        </div>
      </div>

      <!-- Runtime Benchmark Selector (WASM vs WebGPU) -->
      <div style="margin-bottom:8px; background:rgba(0,0,0,0.3); padding:8px; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <span style="color:#9c8f79; font-size:10px; font-weight:700; text-transform:uppercase;">Execution Runtime</span>
          <span id="dbg-runtime-active" style="color:#4ae176; font-weight:700;">${(searchEngine && searchEngine.activeDevice ? searchEngine.activeDevice.toUpperCase() : 'WASM')}</span>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="dbg-rt-wasm" style="flex:1; padding:5px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:#1e2022; color:#e2e2e5; font-size:10px; font-weight:700; cursor:pointer;">
            Force WASM
          </button>
          <button id="dbg-rt-webgpu" style="flex:1; padding:5px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:#1e2022; color:#e2e2e5; font-size:10px; font-weight:700; cursor:pointer;">
            Try WebGPU
          </button>
        </div>
      </div>

      <!-- Test Object Switcher (Open-Vocabulary Testing) -->
      <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:8px;">
        <span style="color:#9c8f79; font-size:10px; font-weight:700; text-transform:uppercase; display:block; margin-bottom:5px;">Open-Vocabulary Target Test</span>
        <div style="display:flex; flex-wrap:wrap; gap:4px; max-height:80px; overflow-y:auto;">
          ${['backpack', 'headphones', 'wallet', 'earbuds', 'phone', 'water bottle', 'book', 'cup', 'remote', 'keys', 'glasses', 'laptop', 'chair'].map(tgt => `
            <button class="dbg-target-btn" data-target="${tgt}" style="
              padding: 2px 7px;
              border-radius: 9999px;
              border: 1px solid rgba(251,191,36,0.3);
              background: #1e2022;
              color: #ffe1a7;
              font-size: 10px;
              cursor: pointer;
            ">${tgt}</button>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(debugOverlay);

    // Event: Close Button
    const closeBtn = document.getElementById('dbg-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => toggleDebugMode());

    // Event: Threshold Buttons
    const threshBtns = debugOverlay.querySelectorAll('.dbg-th-btn');
    threshBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.thresh);
        if (searchEngine) {
          searchEngine.confidenceThreshold = val;
          const currEl = document.getElementById('dbg-current-thresh');
          if (currEl) currEl.textContent = val.toFixed(2);
        }
        threshBtns.forEach(b => {
          b.style.background = '#1e2022';
          b.style.color = '#e2e2e5';
        });
        btn.style.background = '#fbbf24';
        btn.style.color = '#402d00';
      });
    });

    // Event: Stability Count Buttons
    const scBtns = debugOverlay.querySelectorAll('.dbg-sc-btn');
    scBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.count, 10);
        if (searchEngine) {
          searchEngine.stableDetectionCount = val;
          const currEl = document.getElementById('dbg-current-stable-count');
          if (currEl) currEl.textContent = `${val} frames`;
        }
        scBtns.forEach(b => {
          b.style.background = '#1e2022';
          b.style.color = '#e2e2e5';
        });
        btn.style.background = '#fbbf24';
        btn.style.color = '#402d00';
      });
    });

    // Event: Runtime Buttons
    const wasmBtn = document.getElementById('dbg-rt-wasm');
    const webgpuBtn = document.getElementById('dbg-rt-webgpu');
    if (wasmBtn) {
      wasmBtn.addEventListener('click', () => {
        if (searchEngine) {
          searchEngine.setPreferredDevice('wasm');
          document.getElementById('dbg-runtime-active').textContent = 'WASM (reloading...)';
        }
      });
    }
    if (webgpuBtn) {
      webgpuBtn.addEventListener('click', () => {
        if (searchEngine) {
          searchEngine.setPreferredDevice('webgpu');
          document.getElementById('dbg-runtime-active').textContent = 'WebGPU (testing...)';
        }
      });
    }

    // Event: Target Test Buttons
    const targetBtns = debugOverlay.querySelectorAll('.dbg-target-btn');
    targetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tgt = btn.dataset.target;
        currentSearchTarget = { raw: `Find my ${tgt}`, target: tgt };
        transitionToUnderstood(tgt, `Find my ${tgt}`);
      });
    });

    // Connect real-time debug subscriber
    if (searchEngine) {
      searchEngine.debugMode = true;
      searchEngine.onDebug((data) => {
        const targetEl = document.getElementById('dbg-target');
        const detectedEl = document.getElementById('dbg-detected');
        const dirEl = document.getElementById('dbg-direction');
        const stabEl = document.getElementById('dbg-stability');
        const latEl = document.getElementById('dbg-latency');
        const fpsEl = document.getElementById('dbg-fps');
        const confValEl = document.getElementById('dbg-conf-val');
        const confBarEl = document.getElementById('dbg-conf-bar');
        const boxEl = document.getElementById('dbg-box');
        const errorRowEl = document.getElementById('dbg-error-row');
        const errorEl = document.getElementById('dbg-error');
        const devBadge = document.getElementById('dbg-device-badge');
        const rtActive = document.getElementById('dbg-runtime-active');

        if (targetEl) targetEl.textContent = data.target || '-';
        if (devBadge && data.device) devBadge.textContent = data.device.toUpperCase();
        if (rtActive && data.device) rtActive.textContent = data.device.toUpperCase();

        if (latEl) latEl.textContent = `${data.inferenceTime} ms`;
        if (fpsEl) fpsEl.textContent = `${data.inferenceFPS} inf/s`;
        if (dirEl) dirEl.textContent = (data.direction || 'center').toUpperCase();

        const stableTarget = data.stableDetectionCount || 3;
        const currentCount = data.consecutiveDetections || 0;
        const isStable = currentCount >= stableTarget;
        if (stabEl) {
          stabEl.textContent = `${currentCount} / ${stableTarget} ${isStable ? '(STABLE)' : (currentCount > 0 ? '(CANDIDATE)' : '')}`;
          stabEl.style.color = isStable ? '#4ae176' : (currentCount > 0 ? '#fbbf24' : '#e2e2e5');
        }

        if (data.bestDetection) {
          const conf = data.bestDetection.confidence || 0;
          if (detectedEl) {
            detectedEl.textContent = data.bestDetection.label || data.target || 'detected';
            detectedEl.style.color = conf >= data.confidenceThreshold ? '#4ae176' : '#ffb4ab';
          }
          if (confValEl) {
            confValEl.textContent = conf.toFixed(3);
            confValEl.style.color = conf >= data.confidenceThreshold ? '#4ae176' : '#ffb4ab';
          }
          if (confBarEl) {
            confBarEl.style.width = `${Math.min(100, Math.round(conf * 100))}%`;
            confBarEl.style.background = conf >= data.confidenceThreshold ? '#4ae176' : '#ffb4ab';
          }
        } else {
          if (detectedEl) {
            detectedEl.textContent = 'none';
            detectedEl.style.color = '#9c8f79';
          }
          if (confValEl) {
            confValEl.textContent = '0.000';
            confValEl.style.color = '#9c8f79';
          }
          if (confBarEl) {
            confBarEl.style.width = '0%';
          }
        }

        if (boxEl) {
          if (data.smoothedBox) {
            const b = data.smoothedBox;
            boxEl.textContent = `x:${b.x.toFixed(2)} y:${b.y.toFixed(2)} w:${b.width.toFixed(2)} h:${b.height.toFixed(2)}`;
          } else {
            boxEl.textContent = '[none]';
          }
        }

        if (errorRowEl && errorEl) {
          const hasError = Boolean(data.error);
          errorRowEl.style.display = hasError ? '' : 'none';
          if (hasError) errorEl.textContent = String(data.error);
        }
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
