/* ============================================
   MANTIS — Application Logic
   State machine, speech recognition, camera,
   demo flow, and navigation
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
    const announcements = {
      home: 'Home screen. What are you looking for? Tap to speak.',
      listening: 'Listening. Say what you\'re looking for.',
      understood: 'Finding your backpack. Starting camera.',
      searching: 'Searching with camera. Looking for backpack.',
      found: 'Found! Your backpack is to your right.',
      guidance: 'Active guidance. Follow directions.',
      reached: 'Object reached. Your backpack is here.',
      space: 'My Space. Your environment, remembered.',
      objectMemory: 'Object memory. Headphones details.',
      settings: 'Settings and accessibility.'
    };
    announce(announcements[screenName] || '');
  }

  function updateNavHighlight(screenName) {
    const tabs = document.querySelectorAll('.nav-tab');
    const tabMap = { home: 'home', space: 'space', settings: 'settings' };

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
        // If still on listening screen and didn't get a result, restart or show fallback
        if (currentScreen === 'listening' && hasSpeechAPI) {
          // Give user a moment, then show fallback
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

  function handleVoiceResult(transcript) {
    const lower = transcript.toLowerCase();
    // Accept any input mentioning backpack or just go with it
    if (lower.includes('backpack') || lower.includes('back pack') || lower.includes('bag')) {
      transitionToUnderstood('backpack', transcript);
    } else if (lower.includes('headphone') || lower.includes('head phone')) {
      transitionToUnderstood('headphones', transcript);
    } else if (transcript.length > 0) {
      // For demo, treat any input as a backpack search
      transitionToUnderstood('backpack', transcript);
    }
  }

  // ==========================================
  // SCREEN-SPECIFIC LOGIC
  // ==========================================
  function onScreenEnter(screen) {
    switch (screen) {
      case 'home':
        stopCamera();
        stopSpeechRecognition();
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

  function transitionToUnderstood(objectType, rawTranscript) {
    stopSpeechRecognition();

    const queryEl = document.getElementById('understood-query');
    const statusEl = document.getElementById('understood-status');

    if (objectType === 'backpack') {
      if (queryEl) queryEl.textContent = '"My backpack"';
      if (statusEl) statusEl.textContent = '"Finding your backpack..."';
    } else if (objectType === 'headphones') {
      if (queryEl) queryEl.textContent = '"My headphones"';
      if (statusEl) statusEl.textContent = '"Finding your headphones..."';
    } else {
      if (queryEl) queryEl.textContent = `"${rawTranscript}"`;
      if (statusEl) statusEl.textContent = `"Finding your ${objectType}..."`;
    }

    showScreen('understood');
  }

  async function startSearching() {
    // Start camera before transitioning
    await startCamera();
    showScreen('searching');
  }

  function setupSearchingScreen() {
    // Attach camera
    attachCameraToVideo('camera-video', 'camera-fallback-bg');

    // Hide bounding box initially
    const bbox = document.getElementById('search-bounding-box');
    const scanLine = document.getElementById('search-scan-line');
    const statusText = document.getElementById('search-status-text');
    if (bbox) bbox.style.display = 'none';
    if (scanLine) scanLine.style.display = '';
    if (statusText) statusText.textContent = 'Finding backpack';

    // After 2.5s: show bounding box, update status
    const t1 = setTimeout(() => {
      if (currentScreen !== 'searching') return;
      if (bbox) {
        bbox.style.display = '';
      }
      if (scanLine) scanLine.style.display = 'none';
      if (statusText) statusText.textContent = 'Backpack detected';
      announce('Backpack detected.');

      // After 1.5s more: transition to found
      const t2 = setTimeout(() => {
        if (currentScreen === 'searching') {
          showScreen('found');
        }
      }, 1500);
      searchTimers.push(t2);
    }, 2500);
    searchTimers.push(t1);
  }

  function setupGuidanceScreen() {
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

    // Guidance sequence
    const pillEl = document.getElementById('guidance-direction-text');
    const instrEl = document.getElementById('guidance-instruction-text');
    const pillContainer = document.getElementById('guidance-direction-pill');
    const instrCard = document.getElementById('guidance-instruction-card');

    // Step 1: MOVE RIGHT (initial)
    setGuidanceState(pillEl, instrEl, 'MOVE RIGHT', '"Your backpack is to the right.\nTurn right slowly."');

    // Step 2: YOU'RE LINED UP (after 3s)
    const t1 = setTimeout(() => {
      if (currentScreen !== 'guidance') return;
      animateGuidanceChange(pillContainer, instrCard, () => {
        setGuidanceState(pillEl, instrEl, "YOU'RE LINED UP", '"Your backpack is ahead.\nWalk slowly forward."');
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

    // Reset pause state
    const pauseText = document.getElementById('guidance-pause-text');
    const pauseIcon = document.getElementById('guidance-pause-icon');
    if (pauseText) pauseText.textContent = 'Pause Guidance';
    if (pauseIcon) pauseIcon.textContent = 'pause_circle';
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

    // Recent items
    const recentBackpack = document.getElementById('recent-backpack');
    if (recentBackpack) {
      recentBackpack.addEventListener('click', () => {
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
        showScreen('home');
      });
    }

    // --- SEARCHING SCREEN ---
    const searchingCancel = document.getElementById('searching-cancel');
    if (searchingCancel) {
      searchingCancel.addEventListener('click', () => {
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
        stopCamera();
        showScreen('home');
      });
    }

    const foundBack = document.getElementById('found-back-btn');
    if (foundBack) {
      foundBack.addEventListener('click', () => {
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
        // For demo, start the backpack flow (headphones share same demo)
        transitionToUnderstood('headphones', 'Find my headphones');
      });
    }

    // --- MY SPACE Navigate buttons ---
    const spaceNavigateButtons = document.querySelectorAll('.space-navigate-backpack');
    spaceNavigateButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        transitionToUnderstood('backpack', 'Find my backpack');
      });
    });

    // --- BOTTOM NAV ---
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        if (target && SCREENS[target]) {
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
          stopCamera();
          stopSpeechRecognition();
          showScreen('home');
        }
      }
    });
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
