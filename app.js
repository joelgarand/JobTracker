// JobTracker PWA — Application Logic
const JobTracker = (function () {
  'use strict';

  // ─── EventBus ────────────────────────────────────────────────────────────────
  // Central pub/sub mechanism for decoupled module communication.
  // Modules subscribe to events without direct coupling between components.
  // Requirements: 17.1, 17.5

  const EventBus = (function () {
    const _listeners = {};

    // Event catalog — all supported events for documentation and discoverability
    const EVENTS = {
      WORKDAY_SAVED: 'workday:saved',
      WORKDAY_DELETED: 'workday:deleted',
      JOB_CREATED: 'job:created',
      JOB_UPDATED: 'job:updated',
      JOB_DELETED: 'job:deleted',
      INCOME_UPDATED: 'income:updated',
      LIMITS_UPDATED: 'limits:updated',
      NAVIGATION_CHANGE: 'navigation:change',
      DATA_IMPORTED: 'data:imported',
      PROFILE_UPDATED: 'profile:updated',
      STORAGE_ERROR: 'storage:error',
      STORAGE_UNBLOCKED: 'storage:unblocked',
      EARNINGS_SAVED: 'earnings:saved',
      EARNINGS_DELETED: 'earnings:deleted'
    };

    /**
     * Subscribe to an event.
     * @param {string} event - Event name (use EVENTS constants)
     * @param {Function} callback - Handler function receiving event data
     */
    function on(event, callback) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(callback);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event - Event name
     * @param {Function} callback - The exact function reference passed to on()
     */
    function off(event, callback) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function (fn) { return fn !== callback; });
    }

    /**
     * Emit an event to all subscribers.
     * @param {string} event - Event name
     * @param {*} data - Payload passed to each subscriber callback
     */
    function emit(event, data) {
      if (!_listeners[event]) return;
      var handlers = _listeners[event].slice(); // copy to avoid mutation during iteration
      for (var i = 0; i < handlers.length; i++) {
        try {
          handlers[i](data);
        } catch (e) {
          // Prevent one failing handler from blocking others
        }
      }
    }

    return {
      on: on,
      off: off,
      emit: emit,
      EVENTS: EVENTS
    };
  })();

  // ─── Global Utilities (Req 2.7, 13.6) ────────────────────────────────────────

  /**
   * Shows a toast notification with the given message.
   * Used globally for save failures, import errors, and other transient messages.
   * @param {string} message - The message to display
   * @param {number} [duration=4000] - Duration in ms before auto-hide
   */
  function showToast(message, duration) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    duration = duration || 4000;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () {
      toast.classList.remove('visible');
    }, duration);
  }

  /**
   * Validates a numeric input element on blur.
   * Clamps value to min/max, enforces step, and shows inline error if invalid.
   * @param {HTMLInputElement} input
   */
  function _validateNumericInput(input) {
    if (!input || input.type !== 'number') return;

    var value = input.value.trim();
    if (value === '') return; // empty is OK (optional fields)

    var num = parseFloat(value);
    var min = input.min !== '' ? parseFloat(input.min) : null;
    var max = input.max !== '' ? parseFloat(input.max) : null;
    var step = input.step !== '' && input.step !== 'any' ? parseFloat(input.step) : null;

    // Find the associated error span (sibling with class field-error)
    var errorEl = input.parentElement ? input.parentElement.querySelector('.field-error') : null;

    if (isNaN(num)) {
      input.classList.add('input-error');
      if (errorEl) errorEl.textContent = 'Bitte eine gültige Zahl eingeben.';
      return;
    }

    if (min !== null && num < min) {
      input.classList.add('input-error');
      if (errorEl) errorEl.textContent = 'Mindestwert ist ' + min + '.';
      return;
    }

    if (max !== null && num > max) {
      input.classList.add('input-error');
      if (errorEl) errorEl.textContent = 'Maximalwert ist ' + max + '.';
      return;
    }

    // Valid — clear error state
    input.classList.remove('input-error');
    if (errorEl) errorEl.textContent = '';
  }

  /**
   * Attaches blur validation to all numeric inputs in the document.
   * Called once on DOMContentLoaded.
   */
  function _initNumericValidation() {
    document.addEventListener('blur', function (e) {
      if (e.target && e.target.type === 'number') {
        _validateNumericInput(e.target);
      }
    }, true); // use capture phase to catch all inputs including dynamically added ones
  }

  // ─── LocalStorageManager ────────────────────────────────────────────────────
  const LocalStorageManager = (function () {
    const STORAGE_KEYS = [
      'jt_schema_version',
      'jt_user_profile',
      'jt_jobs',
      'jt_workdays',
      'jt_earnings_extra',
      'jt_rule_config',
      'jt_app_state'
    ];

    const CURRENT_SCHEMA_VERSION = 1;
    const RECHECK_INTERVAL_MS = 5000;

    let _blocked = false;
    let _recheckTimer = null;

    // ── Private helpers ──

    /**
     * Tests whether localStorage is accessible by performing a write/read/remove cycle.
     * @returns {boolean}
     */
    function _testStorage() {
      try {
        const testKey = '__jt_storage_test__';
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Starts the periodic re-check timer that attempts to unblock storage.
     */
    function _startRecheckTimer() {
      if (_recheckTimer !== null) return; // already running
      _recheckTimer = setInterval(function () {
        if (_testStorage()) {
          _blocked = false;
          _stopRecheckTimer();
          EventBus.emit('storage:unblocked', {});
        }
      }, RECHECK_INTERVAL_MS);
    }

    /**
     * Stops the periodic re-check timer.
     */
    function _stopRecheckTimer() {
      if (_recheckTimer !== null) {
        clearInterval(_recheckTimer);
        _recheckTimer = null;
      }
    }

    /**
     * Enters the blocked state and starts periodic re-checks.
     * @param {string} reason
     */
    function _enterBlockedState(reason) {
      _blocked = true;
      _startRecheckTimer();
      EventBus.emit('storage:error', { error: reason });
    }

    // ── Public API ──

    /**
     * Checks if localStorage is supported and accessible.
     * @returns {boolean}
     */
    function isAvailable() {
      return _testStorage();
    }

    /**
     * Returns true when storage is currently blocked (unavailable or quota exceeded).
     * @returns {boolean}
     */
    function isBlocked() {
      return _blocked;
    }

    /**
     * Persists data under the given key as JSON.
     * @param {string} key - Storage key (should be one of STORAGE_KEYS)
     * @param {*} data - Data to serialize and store
     * @returns {{ success: boolean, error?: string }}
     */
    function save(key, data) {
      if (_blocked) {
        return { success: false, error: 'storage_blocked' };
      }
      try {
        localStorage.setItem(key, JSON.stringify(data));
        return { success: true };
      } catch (e) {
        // Quota exceeded or other write failure
        _enterBlockedState('quota_exceeded');
        EventBus.emit('storage:error', { error: 'save_failed', key: key, details: e.message });
        return { success: false, error: e.name === 'QuotaExceededError' ? 'quota_exceeded' : 'save_failed' };
      }
    }

    /**
     * Loads and parses JSON data for the given key.
     * @param {string} key - Storage key
     * @returns {{ success: boolean, data?: *, error?: string }}
     */
    function load(key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) {
          return { success: true, data: null };
        }
        const parsed = JSON.parse(raw);
        return { success: true, data: parsed };
      } catch (e) {
        // Parse error — do not overwrite stored data
        EventBus.emit('storage:error', { error: 'parse_failed', key: key, details: e.message });
        return { success: false, error: 'parse_failed' };
      }
    }

    /**
     * Removes the given key from localStorage.
     * @param {string} key
     * @returns {{ success: boolean, error?: string }}
     */
    function remove(key) {
      if (_blocked) {
        return { success: false, error: 'storage_blocked' };
      }
      try {
        localStorage.removeItem(key);
        return { success: true };
      } catch (e) {
        _enterBlockedState('storage_unavailable');
        return { success: false, error: 'remove_failed' };
      }
    }

    /**
     * Returns the stored schema version integer, defaulting to 1.
     * @returns {number}
     */
    function getSchemaVersion() {
      try {
        const raw = localStorage.getItem('jt_schema_version');
        if (raw === null) return CURRENT_SCHEMA_VERSION;
        const version = parseInt(raw, 10);
        return isNaN(version) ? CURRENT_SCHEMA_VERSION : version;
      } catch (e) {
        return CURRENT_SCHEMA_VERSION;
      }
    }

    /**
     * Exports all jt_* keys as a single JSON string.
     * @returns {string} JSON string of all stored data
     */
    function exportAll() {
      const exported = {};
      for (let i = 0; i < STORAGE_KEYS.length; i++) {
        const key = STORAGE_KEYS[i];
        try {
          const raw = localStorage.getItem(key);
          if (raw !== null) {
            exported[key] = JSON.parse(raw);
          }
        } catch (e) {
          // If a key can't be parsed, include the raw string
          const raw = localStorage.getItem(key);
          if (raw !== null) {
            exported[key] = raw;
          }
        }
      }
      return JSON.stringify(exported);
    }

    /**
     * Imports data from a JSON string, validating schema version before overwriting.
     * @param {string} jsonString - JSON string previously produced by exportAll()
     * @returns {{ success: boolean, error?: string }}
     */
    function importAll(jsonString) {
      if (_blocked) {
        return { success: false, error: 'storage_blocked' };
      }

      // Parse the JSON
      let parsed;
      try {
        parsed = JSON.parse(jsonString);
      } catch (e) {
        EventBus.emit('storage:error', { error: 'import_parse_failed', details: e.message });
        return { success: false, error: 'invalid_json' };
      }

      // Validate it's an object
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { success: false, error: 'invalid_format' };
      }

      // Schema version validation
      if (parsed.jt_schema_version !== undefined) {
        const importedVersion = typeof parsed.jt_schema_version === 'number'
          ? parsed.jt_schema_version
          : parseInt(parsed.jt_schema_version, 10);

        if (isNaN(importedVersion) || importedVersion > CURRENT_SCHEMA_VERSION) {
          EventBus.emit('storage:error', { error: 'unsupported_schema', version: importedVersion });
          return { success: false, error: 'unsupported_schema_version' };
        }
      }

      // Write all keys to localStorage
      try {
        for (const key in parsed) {
          if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            const value = typeof parsed[key] === 'string'
              ? parsed[key]
              : JSON.stringify(parsed[key]);
            localStorage.setItem(key, value);
          }
        }
        return { success: true };
      } catch (e) {
        _enterBlockedState('quota_exceeded');
        return { success: false, error: 'import_write_failed' };
      }
    }

    /**
     * Initializes the manager — checks availability and enters blocked state if needed.
     */
    function init() {
      if (!_testStorage()) {
        _enterBlockedState('storage_unavailable');
      }
    }

    return {
      // Public interface
      save: save,
      load: load,
      remove: remove,
      isAvailable: isAvailable,
      isBlocked: isBlocked,
      getSchemaVersion: getSchemaVersion,
      exportAll: exportAll,
      importAll: importAll,
      init: init,
      // Exposed for testing
      STORAGE_KEYS: STORAGE_KEYS,
      CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION
    };
  })();

  // ─── RuleConfigEngine ─────────────────────────────────────────────────────────
  const RuleConfigEngine = (function () {
    const STORAGE_KEY = 'jt_rule_config';

    // Default 2026 configuration
    const DEFAULT_CONFIGS = {
      2026: {
        year: 2026,
        confirmedByUser: false,
        minijobMonthlyLimit: 603,
        kfbMaxDaysPerYear: 70,
        kfbMaxConsecutiveMonths: 3,
        twentySixWeekThreshold: 26,
        taxProfiles: {
          Minijob: {
            flatRate: 0.02,
            employeeDeduction: false
          },
          Werkstudent: {
            pensionInsurance: true,
            healthInsurance: false,
            careInsurance: false,
            unemploymentInsurance: false
          },
          Teilzeit: {
            incomeTax: true,
            allSocialInsurance: true
          },
          Vollzeit: {
            incomeTax: true,
            allSocialInsurance: true
          },
          KFB: {
            flatRate: 0.25,
            employeeDeduction: false
          }
        },
        socialInsuranceRates: {
          pension: 0.093,
          health: 0.0875,
          care: 0.018,
          careChildless: 0.024,
          unemployment: 0.013
        },
        kirchensteuerRate: 0.08,
        solidaritaetszuschlag: 0.055
      }
    };

    // In-memory cache of all configs keyed by year
    let _configs = {};

    /**
     * Loads configs from localStorage and merges with defaults.
     */
    function _loadConfigs() {
      _configs = {};
      // Start with defaults
      for (var year in DEFAULT_CONFIGS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIGS, year)) {
          _configs[year] = DEFAULT_CONFIGS[year];
        }
      }
      // Overlay persisted configs
      var result = LocalStorageManager.load(STORAGE_KEY);
      if (result.success && result.data !== null && typeof result.data === 'object') {
        for (var yr in result.data) {
          if (Object.prototype.hasOwnProperty.call(result.data, yr)) {
            _configs[yr] = result.data[yr];
          }
        }
      }
    }

    /**
     * Persists the current configs to localStorage.
     * @returns {{ success: boolean, error?: string }}
     */
    function _persistConfigs() {
      return LocalStorageManager.save(STORAGE_KEY, _configs);
    }

    /**
     * Returns the most recent available year as a number.
     * @returns {number}
     */
    function getFallbackYear() {
      var years = Object.keys(_configs).map(Number).sort(function (a, b) { return b - a; });
      return years.length > 0 ? years[0] : 2026;
    }

    /**
     * Returns whether a config exists for the given year.
     * @param {number} year
     * @returns {boolean}
     */
    function hasConfigForYear(year) {
      return Object.prototype.hasOwnProperty.call(_configs, String(year));
    }

    /**
     * Returns the RuleConfig for the given year.
     * Falls back to the most recent available year if the requested year is missing.
     * @param {number} year
     * @returns {object} RuleConfig
     */
    function getConfig(year) {
      if (hasConfigForYear(year)) {
        return _configs[String(year)];
      }
      // Fallback to most recent available year
      var fallback = getFallbackYear();
      return _configs[String(fallback)];
    }

    /**
     * Returns the Minijob monthly limit for the given year.
     * @param {number} year
     * @returns {number}
     */
    function getMinijobLimit(year) {
      return getConfig(year).minijobMonthlyLimit;
    }

    /**
     * Returns the KFB max days per year for the given year.
     * @param {number} year
     * @returns {number}
     */
    function getKFBMaxDays(year) {
      return getConfig(year).kfbMaxDaysPerYear;
    }

    /**
     * Returns the 26-week threshold for the given year.
     * @param {number} year
     * @returns {number}
     */
    function get26WeekThreshold(year) {
      return getConfig(year).twentySixWeekThreshold;
    }

    /**
     * Returns the tax profile for a specific job type and year.
     * @param {number} year
     * @param {string} jobType - One of: Minijob, Werkstudent, Teilzeit, Vollzeit, KFB
     * @returns {object|null} TaxProfile or null if jobType not found
     */
    function getTaxProfile(year, jobType) {
      var config = getConfig(year);
      if (config.taxProfiles && config.taxProfiles[jobType]) {
        return config.taxProfiles[jobType];
      }
      return null;
    }

    /**
     * Marks the config for the given year as confirmed by the user.
     * If no config exists for the year, creates one from the fallback year.
     * @param {number} year
     * @returns {{ success: boolean, error?: string }}
     */
    function confirmConfig(year) {
      var yearStr = String(year);
      if (!_configs[yearStr]) {
        // Create config from fallback
        var fallback = getFallbackYear();
        _configs[yearStr] = Object.assign({}, _configs[String(fallback)], { year: year });
      }
      _configs[yearStr].confirmedByUser = true;
      return _persistConfigs();
    }

    /**
     * Initializes the engine by loading configs from storage.
     */
    function init() {
      _loadConfigs();
      _persistConfigs();
    }

    return {
      getConfig: getConfig,
      getMinijobLimit: getMinijobLimit,
      getKFBMaxDays: getKFBMaxDays,
      get26WeekThreshold: get26WeekThreshold,
      getTaxProfile: getTaxProfile,
      hasConfigForYear: hasConfigForYear,
      getFallbackYear: getFallbackYear,
      confirmYear: confirmConfig,
      confirmConfig: confirmConfig,
      init: init,
      // Exposed for testing
      STORAGE_KEY: STORAGE_KEY
    };
  })();

  // ─── AppState ────────────────────────────────────────────────────────────────
  // In-memory + persisted UI state manager.
  // Persists to localStorage via LocalStorageManager under key 'jt_app_state'.
  // Tracks: onboardingComplete, activeView, activeSubView, lastActiveJobId, themePreference
  // Requirements: 20.1, 20.3
  const AppState = (function () {
    const STORAGE_KEY = 'jt_app_state';

    // Default state shape
    const DEFAULTS = {
      onboardingComplete: false,
      activeView: 'view-daily',
      activeSubView: 'view-daily',
      lastActiveJobId: null,
      themePreference: 'system'
    };

    // In-memory state
    let _state = null;

    // Full application data (jobs, workdays, etc.) for backward compatibility
    let _appData = {
      userProfile: null,
      jobs: [],
      workdays: [],
      earningsExtra: []
    };

    // Year-change prompt queue
    let _yearChangePromptQueued = false;

    /**
     * Persists the current _state to localStorage.
     * @returns {{ success: boolean, error?: string }}
     */
    function _persist() {
      return LocalStorageManager.save(STORAGE_KEY, _state);
    }

    /**
     * Initializes AppState by loading persisted state from localStorage.
     * If no state exists, uses defaults.
     */
    function init() {
      var result = LocalStorageManager.load(STORAGE_KEY);
      if (result.success && result.data !== null && typeof result.data === 'object') {
        // Merge loaded state with defaults to handle missing fields
        _state = Object.assign({}, DEFAULTS, result.data);
      } else {
        _state = Object.assign({}, DEFAULTS);
      }
    }

    /**
     * Gets a value from the state by key.
     * @param {string} key - One of: onboardingComplete, activeView, activeSubView, lastActiveJobId, themePreference
     * @returns {*} The value for the given key, or undefined if key doesn't exist
     */
    function get(key) {
      if (_state === null) return undefined;
      return _state[key];
    }

    /**
     * Sets a value in the state by key and persists to localStorage.
     * @param {string} key - State key to update
     * @param {*} value - New value
     * @returns {{ success: boolean, error?: string }}
     */
    function set(key, value) {
      if (_state === null) {
        _state = Object.assign({}, DEFAULTS);
      }
      _state[key] = value;
      return _persist();
    }

    /**
     * Returns whether onboarding has been completed.
     * @returns {boolean}
     */
    function isOnboardingComplete() {
      return _state !== null ? !!_state.onboardingComplete : false;
    }

    /**
     * Sets the onboarding completion status and persists.
     * @param {boolean} value
     * @returns {{ success: boolean, error?: string }}
     */
    function setOnboardingComplete(value) {
      return set('onboardingComplete', !!value);
    }

    /**
     * Returns the currently active view ID.
     * @returns {string}
     */
    function getActiveView() {
      return _state !== null ? (_state.activeView || 'view-daily') : 'view-daily';
    }

    /**
     * Sets the active view and persists.
     * @param {string} viewId
     * @returns {{ success: boolean, error?: string }}
     */
    function setActiveView(viewId) {
      return set('activeView', viewId);
    }

    // ── Backward-compatible methods ──
    // These maintain compatibility with existing code that uses the older interface.

    /**
     * Returns the appState object (UI state) for backward compatibility.
     * @returns {object}
     */
    function getAppState() {
      return _state || Object.assign({}, DEFAULTS);
    }

    /**
     * Updates a single field within appState and persists (backward compat).
     * @param {string} field - Field name within appState
     * @param {*} value - The new value
     * @returns {{ success: boolean, error?: string }}
     */
    function updateAppState(field, value) {
      return set(field, value);
    }

    /**
     * Returns the full application state including app data (backward compat).
     * @returns {object}
     */
    function getState() {
      return {
        userProfile: _appData.userProfile,
        jobs: _appData.jobs,
        workdays: _appData.workdays,
        earningsExtra: _appData.earningsExtra,
        appState: _state || Object.assign({}, DEFAULTS)
      };
    }

    /**
     * Returns whether a year-change prompt is queued.
     * @returns {boolean}
     */
    function isYearChangePromptQueued() {
      return _yearChangePromptQueued;
    }

    /**
     * Updates a specific key in the application data and persists to localStorage (backward compat).
     * @param {string} key - One of: userProfile, jobs, workdays, earningsExtra, appState
     * @param {*} value - The new value
     * @returns {{ success: boolean, error?: string }}
     */
    function setState(key, value) {
      const keyMap = {
        userProfile: 'jt_user_profile',
        jobs: 'jt_jobs',
        workdays: 'jt_workdays',
        earningsExtra: 'jt_earnings_extra',
        appState: STORAGE_KEY
      };

      if (!keyMap[key]) {
        return { success: false, error: 'invalid_key' };
      }

      if (key === 'appState') {
        // Update the UI state
        _state = Object.assign({}, DEFAULTS, value);
        return _persist();
      }

      _appData[key] = value;
      var result = LocalStorageManager.save(keyMap[key], value);

      if (!result.success) {
        showToast('Speichern fehlgeschlagen. Änderungen sind im Speicher, konnten aber nicht gesichert werden.');
      }

      return result;
    }

    /**
     * Displays the error banner with a given message.
     * @param {string} message
     */
    function _showErrorBanner(message) {
      var banner = document.getElementById('error-banner');
      var msgEl = document.getElementById('error-banner-message');
      if (banner && msgEl) {
        msgEl.textContent = message;
        banner.classList.add('visible');
      }
    }

    /**
     * Hides the error banner.
     */
    function _hideErrorBanner() {
      var banner = document.getElementById('error-banner');
      if (banner) {
        banner.classList.remove('visible');
      }
    }

    /**
     * Checks if the current year has a confirmed RuleConfig.
     * If no confirmed config exists for the current year, queues a prompt.
     */
    function _checkYearChange() {
      var currentYear = new Date().getFullYear();

      if (!RuleConfigEngine.hasConfigForYear(currentYear)) {
        _yearChangePromptQueued = true;
        EventBus.emit('yearchange:prompt_needed', { year: currentYear, reason: 'no_config' });
        return;
      }

      var config = RuleConfigEngine.getConfig(currentYear);
      if (config && !config.confirmedByUser) {
        _yearChangePromptQueued = true;
        EventBus.emit('yearchange:prompt_needed', { year: currentYear, reason: 'not_confirmed' });
      }
    }

    /**
     * Initializes the full application by loading all data from localStorage,
     * validating schema version, and populating in-memory state.
     */
    function initApp() {
      // Initialize LocalStorageManager first
      LocalStorageManager.init();

      if (!LocalStorageManager.isAvailable()) {
        _showErrorBanner('Speicher nicht verfügbar. Änderungen sind blockiert.');
        _state = Object.assign({}, DEFAULTS);
        return;
      }

      var schemaVersion = LocalStorageManager.getSchemaVersion();
      if (schemaVersion > LocalStorageManager.CURRENT_SCHEMA_VERSION) {
        _showErrorBanner('Daten wurden mit einer neueren Version gespeichert. Bitte App aktualisieren.');
        _state = Object.assign({}, DEFAULTS);
        return;
      }

      var loadErrors = [];

      // Load user profile
      var profileResult = LocalStorageManager.load('jt_user_profile');
      if (profileResult.success) {
        _appData.userProfile = profileResult.data;
      } else {
        loadErrors.push('user profile');
      }

      // Load jobs
      var jobsResult = LocalStorageManager.load('jt_jobs');
      if (jobsResult.success) {
        _appData.jobs = jobsResult.data || [];
      } else {
        loadErrors.push('jobs');
      }

      // Load workdays
      var workdaysResult = LocalStorageManager.load('jt_workdays');
      if (workdaysResult.success) {
        _appData.workdays = workdaysResult.data || [];
      } else {
        loadErrors.push('workdays');
      }

      // Load earnings extra
      var earningsResult = LocalStorageManager.load('jt_earnings_extra');
      if (earningsResult.success) {
        _appData.earningsExtra = earningsResult.data || [];
      } else {
        loadErrors.push('earnings');
      }

      // Initialize AppState (UI state) via init()
      init();

      if (loadErrors.length > 0) {
        _showErrorBanner('Fehler beim Laden (' + loadErrors.join(', ') + '). Einige Daten sind möglicherweise nicht verfügbar.');
      } else {
        _hideErrorBanner();
      }

      // Initialize RuleConfigEngine and check year-change
      RuleConfigEngine.init();
      _checkYearChange();

      EventBus.on('storage:unblocked', function () {
        _hideErrorBanner();
      });

      EventBus.on('storage:error', function (data) {
        if (data && (data.error === 'storage_unavailable' || data.error === 'quota_exceeded')) {
          _showErrorBanner('Speicher nicht verfügbar. Änderungen sind blockiert.');
        }
      });
    }

    return {
      // Primary interface (per design doc)
      init: init,
      get: get,
      set: set,
      isOnboardingComplete: isOnboardingComplete,
      setOnboardingComplete: setOnboardingComplete,
      getActiveView: getActiveView,
      setActiveView: setActiveView,
      // Backward-compatible interface (used by existing modules)
      getState: getState,
      getAppState: getAppState,
      isYearChangePromptQueued: isYearChangePromptQueued,
      setState: setState,
      updateAppState: updateAppState,
      initApp: initApp,
      // Exposed for testing
      STORAGE_KEY: STORAGE_KEY
    };
  })();

  // ─── NavigationController ─────────────────────────────────────────────────────
  // Manages view switching (3-tab bottom nav + sub-nav within Tracking).
  // Bottom nav: Übersicht (view-daily), Eintragen (view-entry), Einstellungen (view-settings)
  // Sub-nav within Tracking: Übersicht (view-daily), Monat (view-monthly), Jahr (view-yearly)
  // Hides bottom nav during onboarding. Emits navigation:change event via EventBus.
  // Persists active view/sub-view to AppState.
  // Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7
  const NavigationController = (function () {
    const VIEW_IDS = ['view-pwa-install', 'view-onboarding', 'view-daily', 'view-monthly', 'view-yearly', 'view-entry', 'view-settings'];
    const SUB_VIEW_IDS = ['view-daily', 'view-monthly', 'view-yearly'];
    const TRACKING_VIEWS = ['view-daily', 'view-monthly', 'view-yearly'];

    let _activeView = null;
    let _activeSubView = null;
    let _transitioning = false;
    let _transitionQueue = [];
    let _viewInitFns = {};
    let _viewInitialized = {};

    /**
     * Returns true if a view transition is currently in progress.
     * @returns {boolean}
     */
    function isTransitioning() {
      return _transitioning;
    }

    /**
     * Returns the current active view ID.
     * @returns {string}
     */
    function getActiveView() {
      return _activeView || 'view-daily';
    }

    /**
     * Returns the current active sub-view ID within Tracking.
     * @returns {string}
     */
    function getActiveSubView() {
      return _activeSubView || 'view-daily';
    }

    /**
     * Registers a lazy initialization function for a view.
     * The initFn will be called the first time the view is shown.
     * @param {string} viewId
     * @param {Function} initFn
     */
    function registerView(viewId, initFn) {
      _viewInitFns[viewId] = initFn;
    }

    /**
     * Hides all view sections.
     */
    function _hideAllViews() {
      for (var i = 0; i < VIEW_IDS.length; i++) {
        var el = document.getElementById(VIEW_IDS[i]);
        if (el) {
          el.classList.remove('active');
          el.style.display = 'none';
        }
      }
    }

    /**
     * Shows the specified view section.
     * @param {string} viewId
     */
    function _showView(viewId) {
      var el = document.getElementById(viewId);
      if (el) {
        el.style.display = '';
        el.classList.add('active');
      }
    }

    /**
     * Updates the bottom nav bar to highlight the active tab.
     * For tracking sub-views (view-daily, view-monthly, view-yearly),
     * the "Tracking" tab (data-view="view-daily") stays highlighted.
     * @param {string} viewId
     */
    function _updateNavBar(viewId) {
      // Determine which bottom tab should be active
      var activeTabView = viewId;
      if (TRACKING_VIEWS.indexOf(viewId) !== -1) {
        activeTabView = 'view-daily'; // Tracking tab always highlighted for sub-views
      }

      var tabs = document.querySelectorAll('.nav-tab');
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        if (tab.getAttribute('data-view') === activeTabView) {
          tab.classList.add('active');
          tab.setAttribute('aria-current', 'page');
        } else {
          tab.classList.remove('active');
          tab.removeAttribute('aria-current');
        }
      }
    }

    /**
     * Updates the sub-nav buttons to highlight the active sub-view.
     * @param {string} subViewId
     */
    function _updateSubNav(subViewId) {
      var btns = document.querySelectorAll('.sub-nav-btn');
      for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        if (btn.getAttribute('data-target') === subViewId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    }

    /**
     * Shows or hides the bottom nav bar.
     * @param {boolean} visible - true to show, false to hide
     */
    function _setBottomNavVisible(visible) {
      var nav = document.querySelector('.bottom-nav');
      if (nav) {
        nav.style.display = visible ? '' : 'none';
      }
    }

    /**
     * Disables or enables nav bar tabs.
     * @param {boolean} disabled
     */
    function _setNavTabsDisabled(disabled) {
      var tabs = document.querySelectorAll('.nav-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].disabled = disabled;
        if (disabled) {
          tabs[i].setAttribute('aria-disabled', 'true');
        } else {
          tabs[i].removeAttribute('aria-disabled');
        }
      }
    }

    /**
     * Runs lazy initialization for a view if registered and not yet called.
     * @param {string} viewId
     */
    function _lazyInit(viewId) {
      if (_viewInitFns[viewId] && !_viewInitialized[viewId]) {
        _viewInitialized[viewId] = true;
        try {
          _viewInitFns[viewId]();
        } catch (e) {
          // Initialization error — continue with transition
        }
      }
    }

    /**
     * Processes the next queued transition, if any.
     */
    function _processQueue() {
      if (_transitionQueue.length > 0) {
        var nextViewId = _transitionQueue.shift();
        _performTransition(nextViewId);
      }
    }

    /**
     * Performs the actual view transition.
     * @param {string} viewId
     */
    function _performTransition(viewId) {
      // Validate viewId
      if (VIEW_IDS.indexOf(viewId) === -1) {
        return;
      }

      // If already on this view and not transitioning from queue, skip
      if (viewId === _activeView && !_transitioning) {
        _processQueue();
        return;
      }

      _transitioning = true;

      // Run lazy init if registered and not yet called
      _lazyInit(viewId);

      _hideAllViews();
      _showView(viewId);
      _updateNavBar(viewId);

      _activeView = viewId;

      // Track sub-view if this is a tracking view
      if (TRACKING_VIEWS.indexOf(viewId) !== -1) {
        _activeSubView = viewId;
        _updateSubNav(viewId);
        AppState.set('activeSubView', viewId);
      }

      // Persist active view to AppState
      AppState.set('activeView', viewId);

      // Emit navigation change event with viewId and subView
      var payload = { viewId: viewId };
      if (TRACKING_VIEWS.indexOf(viewId) !== -1) {
        payload.subView = viewId;
      }
      EventBus.emit('navigation:change', payload);

      // Short timeout to mark transition as complete
      setTimeout(function () {
        _transitioning = false;
        _processQueue();
      }, 50);
    }

    /**
     * Switches to the specified view. If a transition is in progress,
     * the request is queued and executed after the current transition completes.
     * When switching to "Tracking" (view-daily from bottom nav), shows the last active sub-view.
     * @param {string} viewId
     */
    function switchTo(viewId) {
      // If onboarding is not complete, only allow view-onboarding and view-pwa-install
      if (!AppState.isOnboardingComplete() && viewId !== 'view-onboarding' && viewId !== 'view-pwa-install') {
        return;
      }

      // When tapping the Tracking tab, show the last active sub-view
      if (viewId === 'view-daily' && _activeSubView && _activeSubView !== 'view-daily') {
        // Only redirect if we're not already on a tracking sub-view
        if (TRACKING_VIEWS.indexOf(_activeView) === -1) {
          viewId = _activeSubView;
        }
      }

      if (_transitioning) {
        _transitionQueue.push(viewId);
        return;
      }

      _performTransition(viewId);
    }

    /**
     * Switches to a sub-view within Tracking without changing the bottom tab highlight.
     * Sub-views: view-daily (Übersicht), view-monthly (Monat), view-yearly (Jahr)
     * @param {string} subViewId
     */
    function switchSubView(subViewId) {
      // Validate sub-view ID
      if (SUB_VIEW_IDS.indexOf(subViewId) === -1) {
        return;
      }

      // If onboarding is not complete, ignore
      if (!AppState.isOnboardingComplete()) {
        return;
      }

      // If already on this sub-view, reset to current period and re-render
      if (subViewId === _activeView) {
        if (subViewId === 'view-monthly') {
          EventBus.emit('monthly:reset_to_current', {});
        } else if (subViewId === 'view-yearly') {
          EventBus.emit('yearly:reset_to_current', {});
        }
        return;
      }

      // Run lazy init for the sub-view
      _lazyInit(subViewId);

      // Hide all views and show the target sub-view
      _hideAllViews();
      _showView(subViewId);

      // Update state
      _activeView = subViewId;
      _activeSubView = subViewId;

      // Update sub-nav highlighting (bottom nav stays on Tracking)
      _updateSubNav(subViewId);
      _updateNavBar(subViewId);

      // Persist to AppState
      AppState.set('activeView', subViewId);
      AppState.set('activeSubView', subViewId);

      // Emit navigation change event
      EventBus.emit('navigation:change', { viewId: subViewId, subView: subViewId });
    }

    /**
     * Binds click handlers to bottom nav tab buttons.
     */
    function _bindNavTabs() {
      var tabs = document.querySelectorAll('.nav-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function () {
          var viewId = this.getAttribute('data-view');
          if (viewId) {
            switchTo(viewId);
          }
        });
      }
    }

    /**
     * Binds click handlers to sub-nav buttons within Tracking.
     */
    function _bindSubNavButtons() {
      var btns = document.querySelectorAll('.sub-nav-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          var target = this.getAttribute('data-target');
          if (target) {
            switchSubView(target);
          }
        });
      }
    }

    /**
     * Initializes the NavigationController.
     * Reads active view from AppState and shows the correct section.
     * If onboarding is not complete, forces view-onboarding and hides bottom nav.
     */
    function init() {
      // Hide all views initially
      _hideAllViews();

      // Bind nav tab click handlers
      _bindNavTabs();

      // Bind sub-nav button click handlers
      _bindSubNavButtons();

      // Check onboarding status
      if (!AppState.isOnboardingComplete()) {
        // Detect if running as installed PWA (standalone mode)
        var isStandalone = window.navigator.standalone === true ||
          window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(display-mode: fullscreen)').matches;

        // If in browser (not standalone) and on iOS Safari, show PWA install prompt
        var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        var isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);
        var showInstallPrompt = !isStandalone && isIOS && isSafari && !AppState.get('pwaInstallSkipped');

        _setBottomNavVisible(false);
        _setNavTabsDisabled(true);

        if (showInstallPrompt) {
          // Show PWA install instructions
          _activeView = 'view-pwa-install';
          _activeSubView = 'view-daily';
          _showView('view-pwa-install');
          _updateNavBar('');
          EventBus.emit('navigation:change', { viewId: 'view-pwa-install' });
        } else {
          // Show onboarding directly (already standalone or not iOS Safari)
          _activeView = 'view-onboarding';
          _activeSubView = 'view-daily';
          _showView('view-onboarding');
          _updateNavBar('');
          AppState.set('activeView', 'view-onboarding');
          _lazyInit('view-onboarding');
          EventBus.emit('navigation:change', { viewId: 'view-onboarding' });
        }
        return;
      }

      // Show bottom nav and enable nav tabs
      _setBottomNavVisible(true);
      _setNavTabsDisabled(false);

      // Read active view and sub-view from AppState
      var appState = AppState.getAppState();
      var targetView = appState.activeView || 'view-daily';
      _activeSubView = appState.activeSubView || 'view-daily';

      // Validate the stored view ID
      if (VIEW_IDS.indexOf(targetView) === -1 || targetView === 'view-onboarding') {
        targetView = 'view-daily';
      }

      // Validate the stored sub-view ID
      if (SUB_VIEW_IDS.indexOf(_activeSubView) === -1) {
        _activeSubView = 'view-daily';
      }

      // Run lazy init if registered
      _lazyInit(targetView);

      _activeView = targetView;
      _showView(targetView);
      _updateNavBar(targetView);

      // Update sub-nav highlighting if on a tracking view
      if (TRACKING_VIEWS.indexOf(targetView) !== -1) {
        _updateSubNav(targetView);
      }

      // Emit initial navigation event
      var payload = { viewId: targetView };
      if (TRACKING_VIEWS.indexOf(targetView) !== -1) {
        payload.subView = targetView;
      }
      EventBus.emit('navigation:change', payload);
    }

    return {
      init: init,
      switchTo: switchTo,
      switchSubView: switchSubView,
      getActiveView: getActiveView,
      getActiveSubView: getActiveSubView,
      isTransitioning: isTransitioning,
      registerView: registerView
    };
  })();

  // ─── ThemeManager ─────────────────────────────────────────────────────────────
  // Handles dark/light/system theme switching via CSS class on body.
  // Persists preference to AppState and respects prefers-color-scheme media query.
  // Requirements: 1.4
  const ThemeManager = (function () {
    let _preference = 'system';
    let _mediaQuery = null;
    let _mediaQueryListener = null;

    /**
     * Resolves the effective theme ('light' or 'dark') for 'system' mode
     * by checking the prefers-color-scheme media query.
     * @returns {'light'|'dark'}
     */
    function _getSystemTheme() {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }

    /**
     * Applies the appropriate CSS class to the body element based on the
     * current preference. For 'system', resolves via matchMedia.
     */
    function _applyThemeClass() {
      document.body.classList.remove('theme-light', 'theme-dark');

      var effectiveTheme;
      if (_preference === 'system') {
        effectiveTheme = _getSystemTheme();
      } else {
        effectiveTheme = _preference;
      }

      if (effectiveTheme === 'light') {
        document.body.classList.add('theme-light');
      } else {
        document.body.classList.add('theme-dark');
      }
    }

    /**
     * Updates the active state of theme toggle buttons in settings.
     */
    function _updateToggleUI() {
      var buttons = document.querySelectorAll('.theme-option');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        if (btn.getAttribute('data-theme') === _preference) {
          btn.classList.add('active');
          btn.setAttribute('aria-checked', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-checked', 'false');
        }
      }
    }

    /**
     * Handles system color scheme changes in real-time (only relevant when
     * preference is 'system').
     */
    function _onSystemThemeChange() {
      if (_preference === 'system') {
        _applyThemeClass();
      }
    }

    /**
     * Binds click handlers to theme toggle buttons.
     */
    function _bindThemeToggle() {
      var buttons = document.querySelectorAll('.theme-option');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener('click', function () {
          var theme = this.getAttribute('data-theme');
          if (theme) {
            setTheme(theme);
          }
        });
      }
    }

    /**
     * Sets the theme preference, applies it, updates UI, and persists to AppState.
     * @param {'light'|'dark'|'system'} preference
     */
    function setTheme(preference) {
      if (preference !== 'light' && preference !== 'dark' && preference !== 'system') {
        preference = 'system';
      }
      _preference = preference;
      _applyThemeClass();
      _updateToggleUI();
      AppState.set('themePreference', preference);
    }

    /**
     * Returns the current theme preference string.
     * @returns {string} 'light', 'dark', or 'system'
     */
    function getTheme() {
      return _preference;
    }

    /**
     * Initializes ThemeManager:
     * - Reads themePreference from AppState (default: 'system')
     * - Applies the appropriate CSS class to body
     * - Listens for system color scheme changes
     * - Binds theme toggle buttons
     */
    function init() {
      // Read persisted preference from AppState
      var stored = AppState.get('themePreference');
      _preference = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';

      // Apply theme class
      _applyThemeClass();

      // Update toggle button UI
      _updateToggleUI();

      // Listen for system color scheme changes
      _mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      _mediaQueryListener = _onSystemThemeChange;
      if (_mediaQuery.addEventListener) {
        _mediaQuery.addEventListener('change', _mediaQueryListener);
      } else if (_mediaQuery.addListener) {
        // Fallback for older browsers
        _mediaQuery.addListener(_mediaQueryListener);
      }

      // Bind theme toggle buttons
      _bindThemeToggle();
    }

    return {
      init: init,
      setTheme: setTheme,
      getTheme: getTheme
    };
  })();

  // ─── OnboardingNavigation ─────────────────────────────────────────────────────
  // Handles step navigation for the onboarding flow (HTML structure + nav logic).
  // Full validation and submission logic is implemented in task 5.2.
  const OnboardingNavigation = (function () {
    const TOTAL_STEPS = 3;
    let _currentStep = 1;

    /**
     * Returns the current step number.
     * @returns {number}
     */
    function getCurrentStep() {
      return _currentStep;
    }

    /**
     * Shows the specified step and hides all others.
     * Updates progress dots and button states.
     * @param {number} step - Step number (1-4)
     */
    function goToStep(step) {
      if (step < 1 || step > TOTAL_STEPS) return;

      _currentStep = step;

      // Hide all steps
      for (var i = 1; i <= TOTAL_STEPS; i++) {
        var stepEl = document.getElementById('onboarding-step-' + i);
        if (stepEl) {
          stepEl.style.display = (i === step) ? '' : 'none';
        }
      }

      // Update progress dots
      var dots = document.querySelectorAll('.onboarding-progress .step-dot');
      for (var d = 0; d < dots.length; d++) {
        var dotStep = d + 1;
        dots[d].classList.remove('active', 'completed');
        if (dotStep === step) {
          dots[d].classList.add('active');
        } else if (dotStep < step) {
          dots[d].classList.add('completed');
        }
      }

      // Update Back button visibility
      var backBtn = document.getElementById('onb-btn-back');
      if (backBtn) {
        backBtn.style.visibility = (step === 1) ? 'hidden' : 'visible';
      }

      // Update Next button text
      var nextBtn = document.getElementById('onb-btn-next');
      if (nextBtn) {
        if (step === TOTAL_STEPS) {
          nextBtn.textContent = 'Fertig';
          nextBtn.setAttribute('aria-label', 'Einrichtung abschließen');
        } else {
          nextBtn.textContent = 'Weiter';
          nextBtn.setAttribute('aria-label', 'Zum nächsten Schritt');
        }
      }
    }

    /**
     * Handles the salary type radio change to show/hide hourly rate field.
     */
    function _handleSalaryTypeChange() {
      var hourlyRadio = document.querySelector('input[name="onb-salary-type"][value="hourly"]');
      var hourlyGroup = document.getElementById('onb-hourly-rate-group');
      if (!hourlyRadio || !hourlyGroup) return;

      var radios = document.querySelectorAll('input[name="onb-salary-type"]');
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener('change', function () {
          hourlyGroup.style.display = hourlyRadio.checked ? '' : 'none';
        });
      }
    }

    /**
     * Binds click handlers for Next and Back buttons.
     * The Next button emits 'onboarding:next' for OnboardingModule to intercept.
     * If OnboardingModule is not loaded, falls back to direct navigation.
     */
    function _bindButtons() {
      var nextBtn = document.getElementById('onb-btn-next');
      var backBtn = document.getElementById('onb-btn-back');

      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          // Emit event for OnboardingModule to intercept and validate
          EventBus.emit('onboarding:next', { currentStep: _currentStep });
        });
      }

      if (backBtn) {
        backBtn.addEventListener('click', function () {
          if (_currentStep > 1) {
            EventBus.emit('onboarding:back', { currentStep: _currentStep });
          }
        });
      }
    }

    /**
     * Initializes the onboarding navigation.
     */
    function init() {
      _bindButtons();
      _handleSalaryTypeChange();

      // Job type rules info box
      var jobTypeSelect = document.getElementById('onb-job-type');
      if (jobTypeSelect) {
        jobTypeSelect.addEventListener('change', function() {
          var rulesBox = document.getElementById('onb-job-rules-info');
          if (!rulesBox) return;
          var type = jobTypeSelect.value;
          if (!type) { rulesBox.style.display = 'none'; return; }

          var rules = {
            'KFB': '<h4>📋 KFB — Kurzfristige Beschäftigung</h4><ul>' +
              '<li>Max. 70 Arbeitstage oder 3 Monate im Kalenderjahr</li>' +
              '<li>Keine Sozialversicherungspflicht</li>' +
              '<li>Pauschale Lohnsteuer 25% (oder individuell nach Steuerklasse)</li>' +
              '<li>Nicht berufsmäßig ausgeübt (kein Haupterwerb)</li>' +
              '<li>Kombinierbar mit: Minijob, Werkstudent, Teilzeit</li>' +
              '<li>Nicht kombinierbar mit: Vollzeit</li></ul>',
            'Minijob': '<h4>📋 Minijob — Geringfügige Beschäftigung</h4><ul>' +
              '<li>Max. 603 €/Monat (2026)</li>' +
              '<li>Arbeitnehmer zahlt 3,6% Rentenversicherung (Aufstockung)</li>' +
              '<li>Keine Lohnsteuer, keine KV/PV/AV für AN</li>' +
              '<li>Befreiung von RV-Pflicht möglich (auf Antrag)</li>' +
              '<li>Kombinierbar mit: Werkstudent, KFB, Teilzeit, Vollzeit</li>' +
              '<li>Max. 1 Minijob steuerfrei neben Hauptjob</li></ul>',
            'Werkstudent': '<h4>📋 Werkstudent</h4><ul>' +
              '<li>Max. 20 Std./Woche während Vorlesungszeit</li>' +
              '<li>In Semesterferien: unbegrenzt</li>' +
              '<li>Nur Rentenversicherung (9,3%) wird abgezogen</li>' +
              '<li>Keine KV/PV/AV-Pflicht (Werkstudentenprivileg)</li>' +
              '<li>26-Wochen-Regel bei Kombination mit Minijob/KFB</li>' +
              '<li>Bei Überschreitung: volle Sozialversicherungspflicht</li>' +
              '<li>Kombinierbar mit: Minijob, KFB</li>' +
              '<li>Nicht kombinierbar mit: Vollzeit</li></ul>',
            'Teilzeit': '<h4>📋 Teilzeit</h4><ul>' +
              '<li>Volle Sozialversicherungspflicht (RV, KV, PV, AV)</li>' +
              '<li>Lohnsteuer nach Steuerklasse</li>' +
              '<li>Solidaritätszuschlag (5,5% auf LSt, mit Freigrenze)</li>' +
              '<li>Ggf. Kirchensteuer (8% oder 9% auf LSt)</li>' +
              '<li>Abzüge gesamt ca. 30–40% je nach Steuerklasse</li>' +
              '<li>Kombinierbar mit: Minijob, KFB</li>' +
              '<li>Nicht kombinierbar mit: Vollzeit</li></ul>',
            'Vollzeit': '<h4>📋 Vollzeit</h4><ul>' +
              '<li>Volle Sozialversicherungspflicht (RV, KV, PV, AV)</li>' +
              '<li>Lohnsteuer nach Steuerklasse</li>' +
              '<li>Solidaritätszuschlag (5,5% auf LSt, mit Freigrenze)</li>' +
              '<li>Ggf. Kirchensteuer (8% oder 9% auf LSt)</li>' +
              '<li>Abzüge gesamt ca. 30–40% je nach Steuerklasse</li>' +
              '<li>Kombinierbar mit: Minijob</li>' +
              '<li>Nicht kombinierbar mit: Teilzeit, Werkstudent, weiterer Vollzeit</li></ul>'
          };

          rulesBox.innerHTML = rules[type] || '';
          rulesBox.style.display = type ? '' : 'none';
        });
      }

      goToStep(1);
    }

    return {
      init: init,
      getCurrentStep: getCurrentStep,
      goToStep: goToStep,
      TOTAL_STEPS: TOTAL_STEPS
    };
  })();

  // ─── JobManager Module ────────────────────────────────────────────────────────
  // CRUD operations for Job entities with validation, UUID generation,
  // EventBus integration, and LocalStorageManager persistence.
  // Requirements: 15.4, 15.5, 15.7, 15.8
  const JobManager = (function () {
    const STORAGE_KEY = 'jt_jobs';
    const VALID_JOB_TYPES = ['KFB', 'Minijob', 'Teilzeit', 'Vollzeit', 'Werkstudent'];
    const VALID_SALARY_TYPES = ['hourly', 'fixed'];

    let _initialized = false;
    let _editingJobId = null;
    let _jobs = []; // In-memory job array

    // ── Helpers ──

    /**
     * Generates a UUID using crypto.randomUUID() with a fallback.
     * @returns {string}
     */
    function _generateUUID() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      // Fallback: RFC4122 v4 UUID
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    /**
     * Persists the in-memory _jobs array to localStorage.
     * Also syncs with AppState for backward compatibility with other modules.
     * @returns {{ success: boolean, error?: string }}
     */
    function _persist() {
      var result = LocalStorageManager.save(STORAGE_KEY, _jobs);
      if (!result.success) {
        showToast('Speichern fehlgeschlagen. Änderungen sind im Speicher, konnten aber nicht gesichert werden.');
      }
      // Sync with AppState so other modules using AppState.getState().jobs stay current
      if (AppState.setState) {
        AppState.setState('jobs', _jobs);
      }
      return result;
    }

    /**
     * Loads jobs from localStorage into the in-memory array.
     */
    function _loadJobs() {
      var result = LocalStorageManager.load(STORAGE_KEY);
      if (result.success && Array.isArray(result.data)) {
        _jobs = result.data;
      } else {
        _jobs = [];
      }
    }

    // ── Data-Layer Public API ──

    /**
     * Validates job data and returns validation result with error messages.
     * @param {object} data - Job input data to validate
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function validateJob(data) {
      var errors = [];

      if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['Ungültige Jobdaten.'] };
      }

      // Type validation
      if (!data.type || VALID_JOB_TYPES.indexOf(data.type) === -1) {
        errors.push('Bitte einen gültigen Job-Typ auswählen (KFB, Minijob, Teilzeit, Vollzeit, Werkstudent).');
      }

      // ── Job-Kombinations-Regeln (deutsche Arbeitsrecht) ──
      if (data.type) {
        var existingJobs = _jobs.filter(function (j) {
          // Exclude the job being edited
          return j.id !== data.id;
        });
        var existingTypes = existingJobs.map(function (j) { return j.type; });

        // Vollzeit + Teilzeit ist nicht erlaubt
        if (data.type === 'Vollzeit' && existingTypes.indexOf('Teilzeit') !== -1) {
          errors.push('Vollzeit und Teilzeit können nicht gleichzeitig ausgeübt werden.');
        }
        if (data.type === 'Teilzeit' && existingTypes.indexOf('Vollzeit') !== -1) {
          errors.push('Teilzeit und Vollzeit können nicht gleichzeitig ausgeübt werden.');
        }

        // Mehrere Vollzeit-Jobs sind nicht erlaubt
        if (data.type === 'Vollzeit' && existingTypes.indexOf('Vollzeit') !== -1) {
          errors.push('Es kann nur ein Vollzeit-Job gleichzeitig ausgeübt werden.');
        }

        // Werkstudent + Vollzeit ist nicht erlaubt
        if (data.type === 'Werkstudent' && existingTypes.indexOf('Vollzeit') !== -1) {
          errors.push('Werkstudent-Status ist nicht mit einem Vollzeit-Job vereinbar.');
        }
        if (data.type === 'Vollzeit' && existingTypes.indexOf('Werkstudent') !== -1) {
          errors.push('Ein Vollzeit-Job ist nicht mit dem Werkstudent-Status vereinbar.');
        }

        // Werkstudent + Teilzeit: Warnung (max 20h/Woche insgesamt)
        if (data.type === 'Werkstudent' && existingTypes.indexOf('Teilzeit') !== -1) {
          errors.push('Werkstudent und Teilzeit: Achtung, insgesamt max. 20 Std./Woche erlaubt (Vorlesungszeit).');
        }
        if (data.type === 'Teilzeit' && existingTypes.indexOf('Werkstudent') !== -1) {
          errors.push('Teilzeit und Werkstudent: Achtung, insgesamt max. 20 Std./Woche erlaubt (Vorlesungszeit).');
        }
      }

      // Employer name validation (1–100 chars)
      if (!data.employerName || typeof data.employerName !== 'string' || data.employerName.trim().length === 0) {
        errors.push('Arbeitgeber ist erforderlich.');
      } else if (data.employerName.trim().length > 100) {
        errors.push('Arbeitgeber darf maximal 100 Zeichen lang sein.');
      }

      // Start date validation (YYYY-MM-DD)
      if (!data.startDate || typeof data.startDate !== 'string') {
        errors.push('Startdatum ist erforderlich.');
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) {
        errors.push('Startdatum muss im Format YYYY-MM-DD sein.');
      }

      // Salary type validation
      if (!data.salaryType || VALID_SALARY_TYPES.indexOf(data.salaryType) === -1) {
        errors.push('Bitte eine gültige Gehaltsart auswählen (hourly, fixed).');
      }

      // Hourly rate required if salary type is hourly
      if (data.salaryType === 'hourly') {
        if (data.defaultHourlyRate == null || data.defaultHourlyRate === '') {
          errors.push('Stundenlohn ist für Stundenjobs erforderlich.');
        } else {
          var rate = Number(data.defaultHourlyRate);
          if (isNaN(rate) || rate < 0.01 || rate > 999.99) {
            errors.push('Stundenlohn muss zwischen 0,01 und 999,99 liegen.');
          }
        }
      }

      // Fixed monthly salary required if salary type is fixed
      if (data.salaryType === 'fixed') {
        if (data.fixedMonthlySalary == null || data.fixedMonthlySalary === '') {
          errors.push('Monatsgehalt ist für Festgehaltsjobs erforderlich.');
        } else {
          var salary = Number(data.fixedMonthlySalary);
          if (isNaN(salary) || salary < 0.01 || salary > 99999.99) {
            errors.push('Monatsgehalt muss zwischen 0,01 und 99.999,99 liegen.');
          }
        }
      }

      // Vacation entitlement (optional, validate range if provided)
      if (data.vacationEntitlement != null && data.vacationEntitlement !== '') {
        var vacation = Number(data.vacationEntitlement);
        if (isNaN(vacation) || vacation < 0 || vacation > 365) {
          errors.push('Urlaubsanspruch muss zwischen 0 und 365 liegen.');
        }
      }

      return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Creates a new job from the provided data.
     * Validates, generates ID, adds timestamps, persists, and emits job:created.
     * @param {object} jobData - Job input data
     * @returns {{ success: boolean, job?: object, error?: string }}
     */
    function createJob(jobData) {
      var validation = validateJob(jobData);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(' ') };
      }

      var now = new Date().toISOString();
      var job = {
        id: _generateUUID(),
        type: jobData.type,
        employerName: jobData.employerName.trim(),
        website: jobData.website || null,
        startDate: jobData.startDate,
        endDate: jobData.endDate || null,
        salaryType: jobData.salaryType,
        defaultHourlyRate: jobData.salaryType === 'hourly' ? Number(jobData.defaultHourlyRate) : null,
        fixedMonthlySalary: jobData.salaryType === 'fixed' ? Number(jobData.fixedMonthlySalary) : null,
        standardHoursPerDay: jobData.standardHoursPerDay != null ? Number(jobData.standardHoursPerDay) : null,
        standardDaysPerWeek: jobData.standardDaysPerWeek != null ? Number(jobData.standardDaysPerWeek) : null,
        hasProvision: !!jobData.hasProvision,
        hasTipTracking: !!jobData.hasTipTracking,
        vacationEntitlement: jobData.vacationEntitlement != null ? Number(jobData.vacationEntitlement) : null,
        billingDay: jobData.billingDay != null ? Number(jobData.billingDay) : null,
        sickDayTracking: !!jobData.sickDayTracking,
        createdAt: now,
        updatedAt: now
      };

      _jobs.push(job);
      var result = _persist();
      if (!result.success) {
        // Remove from memory if persist failed
        _jobs.pop();
        return { success: false, error: result.error || 'persist_failed' };
      }

      EventBus.emit('job:created', { job: job });
      return { success: true, job: job };
    }

    /**
     * Updates an existing job by ID with partial updates.
     * Validates the merged result, updates timestamp, persists, and emits job:updated.
     * @param {string} id - Job ID to update
     * @param {object} updates - Partial job data to merge
     * @returns {{ success: boolean, error?: string }}
     */
    function updateJob(id, updates) {
      if (!id || typeof id !== 'string') {
        return { success: false, error: 'Ungültige Job-ID.' };
      }

      var index = -1;
      for (var i = 0; i < _jobs.length; i++) {
        if (_jobs[i].id === id) {
          index = i;
          break;
        }
      }

      if (index === -1) {
        return { success: false, error: 'Job nicht gefunden.' };
      }

      // Merge updates with existing job for validation
      var existing = _jobs[index];
      var merged = Object.assign({}, existing, updates);

      // Validate the merged result
      var validation = validateJob(merged);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(' ') };
      }

      // Apply updates
      var now = new Date().toISOString();
      var updatedJob = Object.assign({}, existing);

      // Only update allowed fields
      if (updates.type !== undefined) updatedJob.type = updates.type;
      if (updates.employerName !== undefined) updatedJob.employerName = updates.employerName.trim();
      if (updates.website !== undefined) updatedJob.website = updates.website || null;
      if (updates.startDate !== undefined) updatedJob.startDate = updates.startDate;
      if (updates.endDate !== undefined) updatedJob.endDate = updates.endDate || null;
      if (updates.salaryType !== undefined) updatedJob.salaryType = updates.salaryType;
      if (updates.defaultHourlyRate !== undefined) updatedJob.defaultHourlyRate = updates.defaultHourlyRate != null ? Number(updates.defaultHourlyRate) : null;
      if (updates.fixedMonthlySalary !== undefined) updatedJob.fixedMonthlySalary = updates.fixedMonthlySalary != null ? Number(updates.fixedMonthlySalary) : null;
      if (updates.standardHoursPerDay !== undefined) updatedJob.standardHoursPerDay = updates.standardHoursPerDay != null ? Number(updates.standardHoursPerDay) : null;
      if (updates.standardDaysPerWeek !== undefined) updatedJob.standardDaysPerWeek = updates.standardDaysPerWeek != null ? Number(updates.standardDaysPerWeek) : null;
      if (updates.hasProvision !== undefined) updatedJob.hasProvision = !!updates.hasProvision;
      if (updates.hasTipTracking !== undefined) updatedJob.hasTipTracking = !!updates.hasTipTracking;
      if (updates.vacationEntitlement !== undefined) updatedJob.vacationEntitlement = updates.vacationEntitlement != null ? Number(updates.vacationEntitlement) : null;
      if (updates.billingDay !== undefined) updatedJob.billingDay = updates.billingDay != null ? Number(updates.billingDay) : null;
      if (updates.sickDayTracking !== undefined) updatedJob.sickDayTracking = !!updates.sickDayTracking;
      updatedJob.updatedAt = now;

      _jobs[index] = updatedJob;
      var result = _persist();
      if (!result.success) {
        // Revert on failure
        _jobs[index] = existing;
        return { success: false, error: result.error || 'persist_failed' };
      }

      EventBus.emit('job:updated', { job: updatedJob });
      return { success: true };
    }

    /**
     * Deletes a job by ID, along with associated workdays and earnings.
     * Persists changes and emits job:deleted.
     * @param {string} id - Job ID to delete
     * @returns {{ success: boolean, error?: string }}
     */
    function deleteJob(id) {
      if (!id || typeof id !== 'string') {
        return { success: false, error: 'Ungültige Job-ID.' };
      }

      var index = -1;
      for (var i = 0; i < _jobs.length; i++) {
        if (_jobs[i].id === id) {
          index = i;
          break;
        }
      }

      if (index === -1) {
        return { success: false, error: 'Job nicht gefunden.' };
      }

      // Remove the job
      var removed = _jobs.splice(index, 1)[0];
      var result = _persist();
      if (!result.success) {
        // Revert on failure
        _jobs.splice(index, 0, removed);
        return { success: false, error: result.error || 'persist_failed' };
      }

      // Delete associated workdays
      var wdResult = LocalStorageManager.load('jt_workdays');
      if (wdResult.success && Array.isArray(wdResult.data)) {
        var filteredWorkdays = wdResult.data.filter(function (w) { return w.jobId !== id; });
        LocalStorageManager.save('jt_workdays', filteredWorkdays);
      }

      // Delete associated earnings
      var eeResult = LocalStorageManager.load('jt_earnings_extra');
      if (eeResult.success && Array.isArray(eeResult.data)) {
        var filteredEarnings = eeResult.data.filter(function (e) { return e.jobId !== id; });
        LocalStorageManager.save('jt_earnings_extra', filteredEarnings);
      }

      EventBus.emit('job:deleted', { jobId: id });
      return { success: true };
    }

    /**
     * Returns a single job by ID, or null if not found.
     * @param {string} id - Job ID
     * @returns {object|null}
     */
    function getJob(id) {
      if (!id) return null;
      for (var i = 0; i < _jobs.length; i++) {
        if (_jobs[i].id === id) return _jobs[i];
      }
      return null;
    }

    /**
     * Returns all jobs.
     * @returns {object[]}
     */
    function getAllJobs() {
      return _jobs.slice();
    }

    /**
     * Returns active jobs (no endDate or endDate in the future).
     * @returns {object[]}
     */
    function getActiveJobs() {
      var today = new Date().toISOString().slice(0, 10);
      return _jobs.filter(function (job) {
        return !job.endDate || job.endDate >= today;
      });
    }

    /**
     * Clears all field error messages in the job form.
     */
    function _clearErrors() {
      var errorEls = document.querySelectorAll('#settings-job-form .field-error');
      for (var i = 0; i < errorEls.length; i++) {
        errorEls[i].textContent = '';
      }
      // Remove input-error class from all inputs
      var inputs = document.querySelectorAll('#settings-job-form .input-error');
      for (var j = 0; j < inputs.length; j++) {
        inputs[j].classList.remove('input-error');
      }
    }

    /**
     * Sets an error message on a specific field error element.
     * @param {string} id - The error element ID
     * @param {string} message - The error message
     */
    function _setError(id, message) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = message;
      }
    }

    /**
     * Gets the selected salary type from the radio group.
     * @returns {string|null}
     */
    function _getSelectedSalaryType() {
      var radios = document.querySelectorAll('input[name="settings-salary-type"]');
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value;
      }
      return null;
    }

    /**
     * Validates the job form and returns an object with valid flag and errors.
     * Uses the data-layer validateJob() internally but maps to field-specific errors for UI.
     * @returns {{ valid: boolean, errors: object }}
     */
    function _validateForm() {
      var errors = {};

      // Job Type
      var jobType = document.getElementById('settings-job-type').value;
      if (!jobType || VALID_JOB_TYPES.indexOf(jobType) === -1) {
        errors.type = 'Bitte einen gültigen Job-Typ auswählen.';
      }

      // Employer Name
      var employer = document.getElementById('settings-job-employer').value.trim();
      if (!employer) {
        errors.employer = 'Arbeitgeber ist erforderlich.';
      } else if (employer.length > 100) {
        errors.employer = 'Arbeitgeber darf maximal 100 Zeichen lang sein.';
      }

      // Start Date
      var startDate = document.getElementById('settings-job-start-date').value;
      if (!startDate) {
        errors.startDate = 'Startdatum ist erforderlich.';
      }

      // Salary Type
      var salaryType = _getSelectedSalaryType();
      if (!salaryType) {
        errors.salaryType = 'Bitte eine Gehaltsart auswählen.';
      }

      // Hourly Rate (required if salary type is hourly)
      if (salaryType === 'hourly') {
        var hourlyRate = document.getElementById('settings-job-hourly-rate').value;
        if (!hourlyRate) {
          errors.hourlyRate = 'Stundenlohn ist für Stundenjobs erforderlich.';
        } else {
          var rate = parseFloat(hourlyRate);
          if (isNaN(rate) || rate < 0.01 || rate > 999.99) {
            errors.hourlyRate = 'Stundenlohn muss zwischen 0,01 und 999,99 liegen.';
          }
        }
      }

      // Fixed Monthly Salary (required if salary type is fixed)
      if (salaryType === 'fixed') {
        var fixedSalary = document.getElementById('settings-job-fixed-salary').value;
        if (!fixedSalary) {
          errors.fixedSalary = 'Monatsgehalt ist für Festgehaltsjobs erforderlich.';
        } else {
          var salary = parseFloat(fixedSalary);
          if (isNaN(salary) || salary < 0.01 || salary > 99999.99) {
            errors.fixedSalary = 'Monatsgehalt muss zwischen 0,01 und 99.999,99 liegen.';
          }
        }
      }

      // Vacation entitlement (optional, but validate range if provided)
      var vacationInput = document.getElementById('settings-job-vacation').value;
      if (vacationInput !== '' && vacationInput !== null) {
        var vacation = parseInt(vacationInput, 10);
        if (isNaN(vacation) || vacation < 0 || vacation > 365) {
          errors.vacation = 'Urlaubsanspruch muss zwischen 0 und 365 liegen.';
        }
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors: errors
      };
    }

    /**
     * Displays validation errors on the form.
     * @param {object} errors
     */
    function _displayErrors(errors) {
      _clearErrors();
      if (errors.type) {
        _setError('settings-job-type-error', errors.type);
        var typeEl = document.getElementById('settings-job-type');
        if (typeEl) typeEl.classList.add('input-error');
      }
      if (errors.employer) {
        _setError('settings-job-employer-error', errors.employer);
        var empEl = document.getElementById('settings-job-employer');
        if (empEl) empEl.classList.add('input-error');
      }
      if (errors.startDate) {
        _setError('settings-job-start-date-error', errors.startDate);
        var dateEl = document.getElementById('settings-job-start-date');
        if (dateEl) dateEl.classList.add('input-error');
      }
      if (errors.salaryType) {
        _setError('settings-salary-type-error', errors.salaryType);
      }
      if (errors.hourlyRate) {
        _setError('settings-job-hourly-rate-error', errors.hourlyRate);
        var rateEl = document.getElementById('settings-job-hourly-rate');
        if (rateEl) rateEl.classList.add('input-error');
      }
      if (errors.fixedSalary) {
        _setError('settings-job-fixed-salary-error', errors.fixedSalary);
        var salaryEl = document.getElementById('settings-job-fixed-salary');
        if (salaryEl) salaryEl.classList.add('input-error');
      }
      if (errors.vacation) {
        _setError('settings-job-vacation-error', errors.vacation);
        var vacEl = document.getElementById('settings-job-vacation');
        if (vacEl) vacEl.classList.add('input-error');
      }
    }

    /**
     * Resets the job form to its default empty state.
     */
    function _resetForm() {
      _editingJobId = null;
      document.getElementById('settings-job-id').value = '';
      document.getElementById('settings-job-type').value = '';
      document.getElementById('settings-job-employer').value = '';
      document.getElementById('settings-job-start-date').value = '';
      document.getElementById('settings-job-hourly-rate').value = '';
      document.getElementById('settings-job-fixed-salary').value = '';
      document.getElementById('settings-job-vacation').value = '';
      document.getElementById('settings-job-provision').checked = false;
      document.getElementById('settings-job-tips').checked = false;
      document.getElementById('settings-job-sick').checked = false;

      // Reset salary type to hourly
      var hourlyRadio = document.querySelector('input[name="settings-salary-type"][value="hourly"]');
      if (hourlyRadio) hourlyRadio.checked = true;
      _showHourlyRateGroup(true);

      // Reset form title
      document.getElementById('settings-job-form-title').textContent = 'Job hinzufügen';

      // Hide delete button
      document.getElementById('settings-job-delete-btn').style.display = 'none';

      _clearErrors();

      // Reset disabled state of job type options
      var typeSelect = document.getElementById('settings-job-type');
      if (typeSelect) {
        var opts = typeSelect.querySelectorAll('option');
        for (var i = 0; i < opts.length; i++) {
          opts[i].disabled = false;
          opts[i].textContent = opts[i].textContent.replace(/ \(nicht möglich\)$/, '');
        }
      }
    }

    /**
     * Shows or hides the hourly rate group based on salary type.
     * @param {boolean} showHourly
     */
    function _showHourlyRateGroup(showHourly) {
      var hourlyGroup = document.getElementById('settings-hourly-rate-group');
      var fixedGroup = document.getElementById('settings-fixed-salary-group');
      if (hourlyGroup) hourlyGroup.style.display = showHourly ? '' : 'none';
      if (fixedGroup) fixedGroup.style.display = showHourly ? 'none' : '';
    }

    /**
     * Loads a job's data into the form for editing.
     * @param {object} job
     */
    function _loadJobIntoForm(job) {
      _editingJobId = job.id;
      document.getElementById('settings-job-id').value = job.id;
      document.getElementById('settings-job-type').value = job.type;
      document.getElementById('settings-job-employer').value = job.employerName;
      var websiteField = document.getElementById('settings-job-website');
      if (websiteField) websiteField.value = job.website || '';
      document.getElementById('settings-job-start-date').value = job.startDate;

      // Salary type
      var salaryType = job.salaryType || 'hourly';
      var radio = document.querySelector('input[name="settings-salary-type"][value="' + salaryType + '"]');
      if (radio) radio.checked = true;
      _showHourlyRateGroup(salaryType === 'hourly');

      // Rates
      document.getElementById('settings-job-hourly-rate').value = job.defaultHourlyRate != null ? job.defaultHourlyRate : '';
      document.getElementById('settings-job-fixed-salary').value = job.fixedMonthlySalary != null ? job.fixedMonthlySalary : '';

      // Optional fields
      document.getElementById('settings-job-vacation').value = job.vacationEntitlement != null ? job.vacationEntitlement : '';
      var billingDayField = document.getElementById('settings-job-billing-day');
      if (billingDayField) billingDayField.value = job.billingDay != null ? job.billingDay : '';
      document.getElementById('settings-job-provision').checked = !!job.hasProvision;
      document.getElementById('settings-job-tips').checked = !!job.hasTipTracking;
      document.getElementById('settings-job-sick').checked = !!job.sickDayTracking;

      // Update form title and show delete button
      document.getElementById('settings-job-form-title').textContent = 'Job bearbeiten';
      document.getElementById('settings-job-delete-btn').style.display = '';

      _clearErrors();
    }

    // ── Public Methods ──

    /**
     * Renders the job list from the in-memory _jobs array.
     */
    function renderJobList() {
      var container = document.getElementById('settings-job-list');
      if (!container) return;

      var jobs = _jobs;

      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<p class="settings-empty-state">Keine Jobs konfiguriert. Füge deinen ersten Job hinzu.</p>';
        return;
      }

      var html = '';
      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        html += '<div class="settings-job-item" data-job-id="' + job.id + '" tabindex="0" role="button" aria-label="' + _escapeHtml(job.employerName) + ' bearbeiten">';
        html += '<div class="settings-job-item-info">';
        html += '<span class="settings-job-item-name">' + _escapeHtml(job.employerName) + '</span>';
        html += '<span class="settings-job-item-meta">';
        html += '<span class="settings-job-item-badge">' + _escapeHtml(job.type) + '</span>';
        html += '<span>' + _escapeHtml(job.startDate) + '</span>';
        html += '</span>';
        html += '</div>';
        html += '<span class="settings-job-item-arrow">›</span>';
        html += '</div>';
      }
      container.innerHTML = html;

      // Bind click handlers to job items
      var items = container.querySelectorAll('.settings-job-item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', _onJobItemClick);
        items[j].addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            _onJobItemClick.call(this, e);
          }
        });
      }
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Handles clicking on a job item to edit it.
     */
    function _onJobItemClick(e) {
      var jobId = this.getAttribute('data-job-id');
      var job = getJob(jobId);
      if (!job) return;

      _loadJobIntoForm(job);
      _showForm();
    }

    /**
     * Updates the settings job type dropdown to disable incompatible options.
     * Uses the same incompatibility rules as the onboarding module.
     */
    function _updateSettingsJobTypeOptions() {
      var select = document.getElementById('settings-job-type');
      if (!select) return;

      // Get types of all existing jobs, excluding the one being edited
      var existingTypes = [];
      for (var i = 0; i < _jobs.length; i++) {
        if (_jobs[i] && _jobs[i].id !== _editingJobId && _jobs[i].type) {
          existingTypes.push(_jobs[i].type);
        }
      }

      // Determine incompatible types using the same rules as validateJob
      var incompatible = [];
      if (existingTypes.indexOf('Vollzeit') !== -1) {
        incompatible.push('Teilzeit', 'Vollzeit', 'Werkstudent');
      }
      if (existingTypes.indexOf('Teilzeit') !== -1) {
        incompatible.push('Vollzeit');
      }
      if (existingTypes.indexOf('Werkstudent') !== -1) {
        incompatible.push('Vollzeit');
      }

      // Update option states
      var options = select.querySelectorAll('option');
      for (var o = 0; o < options.length; o++) {
        var val = options[o].value;
        if (!val) continue; // Skip placeholder
        if (incompatible.indexOf(val) !== -1) {
          options[o].disabled = true;
          options[o].textContent = options[o].textContent.replace(/ \(nicht möglich\)$/, '') + ' (nicht möglich)';
        } else {
          options[o].disabled = false;
          options[o].textContent = options[o].textContent.replace(/ \(nicht möglich\)$/, '');
        }
      }
    }

    /**
     * Shows the job form container.
     */
    function _showForm() {
      var formContainer = document.getElementById('settings-job-form-container');
      if (formContainer) {
        formContainer.style.display = '';
        formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      _updateSettingsJobTypeOptions();
    }

    /**
     * Hides the job form container.
     */
    function _hideForm() {
      var formContainer = document.getElementById('settings-job-form-container');
      if (formContainer) {
        formContainer.style.display = 'none';
      }
    }

    /**
     * Handles the Add Job button click.
     */
    function _onAddJobClick() {
      _resetForm();
      _showForm();
    }

    /**
     * Handles form submission (add or edit).
     * Uses the data-layer createJob/updateJob API.
     * @param {Event} e
     */
    function _onFormSubmit(e) {
      e.preventDefault();

      var validation = _validateForm();
      if (!validation.valid) {
        _displayErrors(validation.errors);
        return;
      }

      var isEdit = !!_editingJobId;
      var jobData = _buildJobDataFromForm();

      if (isEdit) {
        var result = updateJob(_editingJobId, jobData);
        if (result.success) {
          _hideForm();
          _resetForm();
          renderJobList();
        }
      } else {
        var result = createJob(jobData);
        if (result.success) {
          _hideForm();
          _resetForm();
          renderJobList();
        }
      }
    }

    /**
     * Builds a job data object from the form fields (without ID or timestamps).
     * @returns {object} Job input data
     */
    function _buildJobDataFromForm() {
      var salaryType = _getSelectedSalaryType();
      var hourlyRate = salaryType === 'hourly' ? parseFloat(document.getElementById('settings-job-hourly-rate').value) : null;
      var fixedSalary = salaryType === 'fixed' ? parseFloat(document.getElementById('settings-job-fixed-salary').value) : null;
      var vacationInput = document.getElementById('settings-job-vacation').value;
      var vacation = (vacationInput !== '' && vacationInput !== null) ? parseInt(vacationInput, 10) : null;
      var websiteInput = document.getElementById('settings-job-website');
      var websiteVal = websiteInput ? websiteInput.value.trim() : '';
      // Normalize: remove protocol, www, path, and extract main domain
      websiteVal = websiteVal.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      var domainParts = websiteVal.replace(/^www\./, '').split('.');
      if (domainParts.length > 2) {
        var lastTwo = domainParts.slice(-2).join('.');
        var knownTwoPartTLDs = ['co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'co.kr'];
        if (knownTwoPartTLDs.indexOf(lastTwo) !== -1 && domainParts.length > 3) {
          websiteVal = domainParts.slice(-3).join('.');
        } else if (knownTwoPartTLDs.indexOf(lastTwo) !== -1) {
          websiteVal = domainParts.join('.');
        } else {
          websiteVal = domainParts.slice(-2).join('.');
        }
      } else {
        websiteVal = domainParts.join('.');
      }

      return {
        type: document.getElementById('settings-job-type').value,
        employerName: document.getElementById('settings-job-employer').value.trim(),
        website: websiteVal || null,
        startDate: document.getElementById('settings-job-start-date').value,
        endDate: null,
        salaryType: salaryType,
        defaultHourlyRate: hourlyRate,
        fixedMonthlySalary: fixedSalary,
        standardHoursPerDay: null,
        standardDaysPerWeek: null,
        hasProvision: document.getElementById('settings-job-provision').checked,
        hasTipTracking: document.getElementById('settings-job-tips').checked,
        vacationEntitlement: vacation,
        billingDay: (function() { var bd = document.getElementById('settings-job-billing-day'); return bd && bd.value ? parseInt(bd.value, 10) : null; })(),
        sickDayTracking: document.getElementById('settings-job-sick').checked
      };
    }

    /**
     * Handles the Cancel button click.
     */
    function _onCancelClick() {
      _hideForm();
      _resetForm();
    }

    /**
     * Handles the Delete button click — shows the confirmation modal.
     */
    function _onDeleteClick() {
      if (!_editingJobId) return;

      var job = getJob(_editingJobId);
      if (!job) return;

      // Populate modal
      var modalName = document.getElementById('delete-job-modal-name');
      if (modalName) {
        modalName.textContent = job.employerName;
      }

      // Show modal
      var modal = document.getElementById('delete-job-modal');
      if (modal) {
        modal.classList.add('visible');
        // Focus the cancel button for accessibility
        var cancelBtn = document.getElementById('delete-job-cancel-btn');
        if (cancelBtn) cancelBtn.focus();
      }
    }

    /**
     * Handles confirming job deletion via the data-layer deleteJob API.
     */
    function _onDeleteConfirm() {
      if (!_editingJobId) return;

      var result = deleteJob(_editingJobId);
      if (result.success) {
        // Close modal and form
        _hideDeleteModal();
        _hideForm();
        _resetForm();
        renderJobList();
      }
    }

    /**
     * Handles cancelling job deletion.
     */
    function _onDeleteCancel() {
      _hideDeleteModal();
    }

    /**
     * Hides the delete confirmation modal.
     */
    function _hideDeleteModal() {
      var modal = document.getElementById('delete-job-modal');
      if (modal) {
        modal.classList.remove('visible');
      }
    }

    /**
     * Handles salary type radio change in the settings form.
     */
    function _bindSalaryTypeToggle() {
      var radios = document.querySelectorAll('input[name="settings-salary-type"]');
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener('change', function () {
          var selected = _getSelectedSalaryType();
          _showHourlyRateGroup(selected === 'hourly');
        });
      }
    }

    /**
     * Initializes the JobManager module — loads jobs from storage and binds UI event handlers.
     */
    function init() {
      // Always load jobs from storage (idempotent)
      _loadJobs();

      if (_initialized) return;
      _initialized = true;
    }

    /**
     * Initializes the UI bindings for the settings view.
     * Called when the settings view becomes active.
     */
    function initUI() {
      // Bind Add Job button
      var addBtn = document.getElementById('settings-add-job-btn');
      if (addBtn && !addBtn._bound) {
        addBtn._bound = true;
        addBtn.addEventListener('click', _onAddJobClick);
      }

      // Bind form submission
      var form = document.getElementById('settings-job-form');
      if (form) {
        form.addEventListener('submit', _onFormSubmit);
      }

      // Bind Cancel button
      var cancelBtn = document.getElementById('settings-job-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', _onCancelClick);
      }

      // Bind Delete button
      var deleteBtn = document.getElementById('settings-job-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', _onDeleteClick);
      }

      // Bind modal confirm/cancel
      var confirmBtn = document.getElementById('delete-job-confirm-btn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', _onDeleteConfirm);
      }

      var modalCancelBtn = document.getElementById('delete-job-cancel-btn');
      if (modalCancelBtn) {
        modalCancelBtn.addEventListener('click', _onDeleteCancel);
      }

      // Bind salary type toggle
      _bindSalaryTypeToggle();

      // Render the job list
      renderJobList();
    }

    return {
      // Data-layer API (per design doc)
      init: init,
      initUI: initUI,
      createJob: createJob,
      updateJob: updateJob,
      deleteJob: deleteJob,
      getJob: getJob,
      getAllJobs: getAllJobs,
      getActiveJobs: getActiveJobs,
      validateJob: validateJob,
      // UI methods
      renderJobList: renderJobList,
      // Exposed for testing
      STORAGE_KEY: STORAGE_KEY,
      VALID_JOB_TYPES: VALID_JOB_TYPES
    };
  })();

  // ─── OnboardingModule ─────────────────────────────────────────────────────────
  // Implements validation, job configuration storage, review generation, and submission.
  const OnboardingModule = (function () {
    const VALID_JOB_TYPES = ['KFB', 'Minijob', 'Teilzeit', 'Vollzeit', 'Werkstudent'];
    const VALID_BUNDESLAENDER = [
      'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen',
      'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen',
      'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen',
      'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'
    ];

    // In-memory onboarding data
    let _personalData = null;
    let _numJobs = 1;
    let _jobs = [];
    let _currentJobIndex = 0;
    let _started = false;

    // ── Private helpers ──

    /**
     * Clears all inline error messages for the current step.
     */
    function _clearErrors() {
      var errors = document.querySelectorAll('#view-onboarding .field-error');
      for (var i = 0; i < errors.length; i++) {
        errors[i].textContent = '';
      }
    }

    /**
     * Sets an inline error message on a specific field.
     * @param {string} errorId - The ID of the error span element
     * @param {string} message - The error message
     */
    function _setError(errorId, message) {
      var el = document.getElementById(errorId);
      if (el) {
        el.textContent = message;
      }
    }

    /**
     * Generates a UUID v4.
     * @returns {string}
     */
    function _generateUUID() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      // Fallback
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    // ── Validation ──

    /**
     * Validates Step 1: Personal Data.
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function _validateStep1() {
      var errors = [];
      _clearErrors();

      // Steuerklasse
      var steuerklasse = document.getElementById('onb-steuerklasse');
      var skVal = steuerklasse ? steuerklasse.value : '';
      if (!skVal || parseInt(skVal, 10) < 1 || parseInt(skVal, 10) > 6) {
        errors.push('Steuerklasse ist erforderlich');
        _setError('error-steuerklasse', 'Bitte eine Steuerklasse (I–VI) auswählen');
      }

      // Bundesland
      var bundesland = document.getElementById('onb-bundesland');
      var blVal = bundesland ? bundesland.value : '';
      if (!blVal || VALID_BUNDESLAENDER.indexOf(blVal) === -1) {
        errors.push('Bundesland ist erforderlich');
        _setError('error-bundesland', 'Bitte ein Bundesland auswählen');
      }

      // Krankenversicherung
      var kvRadios = document.querySelectorAll('input[name="onb-krankenversicherung"]');
      var kvSelected = false;
      for (var i = 0; i < kvRadios.length; i++) {
        if (kvRadios[i].checked) { kvSelected = true; break; }
      }
      if (!kvSelected) {
        errors.push('Krankenversicherung ist erforderlich');
        _setError('error-krankenversicherung', 'Bitte gesetzlich oder privat auswählen');
      }

      return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Validates Step 2: Number of Jobs.
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function _validateStep2() {
      var errors = [];
      _clearErrors();

      var numJobsInput = document.getElementById('onb-num-jobs');
      var val = numJobsInput ? parseInt(numJobsInput.value, 10) : NaN;

      if (isNaN(val) || val < 1 || val > 10 || val !== Math.floor(val)) {
        errors.push('Anzahl der Jobs muss eine ganze Zahl zwischen 1 und 10 sein');
        _setError('error-num-jobs', 'Ganze Zahl zwischen 1 und 10 eingeben');
      }

      return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Validates Step 3: Current Job Configuration.
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function _validateStep3() {
      var errors = [];
      _clearErrors();

      // Job Type
      var jobType = document.getElementById('onb-job-type');
      var jtVal = jobType ? jobType.value : '';
      if (!jtVal || VALID_JOB_TYPES.indexOf(jtVal) === -1) {
        errors.push('Job-Typ ist erforderlich');
        _setError('error-job-type', 'Bitte einen Job-Typ auswählen');
      }

      // Employer Name
      var employer = document.getElementById('onb-employer-name');
      var empVal = employer ? employer.value.trim() : '';
      if (!empVal || empVal.length < 1 || empVal.length > 100) {
        errors.push('Arbeitgeber ist erforderlich (1-100 Zeichen)');
        _setError('error-employer-name', 'Arbeitgeber eingeben (1–100 Zeichen)');
      }

      // Start Date
      var startDate = document.getElementById('onb-start-date');
      var sdVal = startDate ? startDate.value : '';
      if (!sdVal) {
        errors.push('Startdatum ist erforderlich');
        _setError('error-start-date', 'Bitte ein Startdatum auswählen');
      }

      // Salary Type
      var salaryRadios = document.querySelectorAll('input[name="onb-salary-type"]');
      var salaryType = '';
      for (var i = 0; i < salaryRadios.length; i++) {
        if (salaryRadios[i].checked) { salaryType = salaryRadios[i].value; break; }
      }
      if (!salaryType) {
        errors.push('Gehaltsart ist erforderlich');
        _setError('error-salary-type', 'Bitte Stundenlohn oder Festgehalt auswählen');
      }

      // Hourly Rate (required if salary type is hourly)
      if (salaryType === 'hourly') {
        var hourlyRate = document.getElementById('onb-hourly-rate');
        var hrVal = hourlyRate ? parseFloat(hourlyRate.value) : NaN;
        if (isNaN(hrVal) || hrVal < 0.01 || hrVal > 999.99) {
          errors.push('Stundenlohn muss zwischen 0,01 und 999,99 liegen');
          _setError('error-hourly-rate', 'Stundenlohn zwischen 0,01 und 999,99 € eingeben');
        }
      }

      return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Collects personal data from Step 1 form fields.
     */
    function _collectPersonalData() {
      var steuerklasse = document.getElementById('onb-steuerklasse');
      var bundesland = document.getElementById('onb-bundesland');
      var kirchensteuer = document.getElementById('onb-kirchensteuer');
      var kvRadios = document.querySelectorAll('input[name="onb-krankenversicherung"]');
      var kvVal = '';
      for (var i = 0; i < kvRadios.length; i++) {
        if (kvRadios[i].checked) { kvVal = kvRadios[i].value; break; }
      }

      _personalData = {
        steuerklasse: parseInt(steuerklasse.value, 10),
        bundesland: bundesland.value,
        kirchensteuer: kirchensteuer ? kirchensteuer.checked : false,
        krankenversicherung: kvVal,
        hasChildren: document.getElementById('onb-has-children') ? document.getElementById('onb-has-children').checked : false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    /**
     * Collects number of jobs from Step 2.
     */
    function _collectNumJobs() {
      var numJobsInput = document.getElementById('onb-num-jobs');
      _numJobs = parseInt(numJobsInput.value, 10);
      // Resize jobs array if needed
      if (_jobs.length > _numJobs) {
        _jobs = _jobs.slice(0, _numJobs);
      }
    }

    /**
     * Collects current job configuration from Step 3 form fields.
     * @returns {object} Job configuration object
     */
    function _collectCurrentJob() {
      var jobType = document.getElementById('onb-job-type');
      var employer = document.getElementById('onb-employer-name');
      var website = document.getElementById('onb-employer-website');
      var startDate = document.getElementById('onb-start-date');
      var salaryRadios = document.querySelectorAll('input[name="onb-salary-type"]');
      var hourlyRate = document.getElementById('onb-hourly-rate');
      var hasProvision = document.getElementById('onb-has-provision');
      var hasTips = document.getElementById('onb-has-tips');
      var vacationDays = document.getElementById('onb-vacation-days');
      var sickTracking = document.getElementById('onb-sick-tracking');

      var salaryType = '';
      for (var i = 0; i < salaryRadios.length; i++) {
        if (salaryRadios[i].checked) { salaryType = salaryRadios[i].value; break; }
      }

      var websiteVal = website ? website.value.trim() : '';
      // Normalize: remove protocol, www, path, and extract main domain
      websiteVal = websiteVal.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      // Remove www. and country subdomains (e.g. de.ploom.com → ploom.com)
      var domainParts = websiteVal.replace(/^www\./, '').split('.');
      if (domainParts.length > 2) {
        // Keep only last two parts (domain.tld) unless it's a known two-part TLD
        var lastTwo = domainParts.slice(-2).join('.');
        var knownTwoPartTLDs = ['co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'co.kr'];
        if (knownTwoPartTLDs.indexOf(lastTwo) !== -1 && domainParts.length > 3) {
          websiteVal = domainParts.slice(-3).join('.');
        } else if (knownTwoPartTLDs.indexOf(lastTwo) !== -1) {
          websiteVal = domainParts.join('.');
        } else {
          websiteVal = domainParts.slice(-2).join('.');
        }
      } else {
        websiteVal = domainParts.join('.');
      }

      var job = {
        id: (_jobs[_currentJobIndex] && _jobs[_currentJobIndex].id) || _generateUUID(),
        type: jobType ? jobType.value : '',
        employerName: employer ? employer.value.trim() : '',
        website: websiteVal || null,
        startDate: startDate ? startDate.value : '',
        endDate: null,
        salaryType: salaryType,
        defaultHourlyRate: salaryType === 'hourly' ? parseFloat(hourlyRate.value) : null,
        fixedMonthlySalary: null,
        standardHoursPerDay: null,
        standardDaysPerWeek: null,
        hasProvision: hasProvision ? hasProvision.checked : false,
        hasTipTracking: hasTips ? hasTips.checked : false,
        vacationEntitlement: vacationDays && vacationDays.value ? parseInt(vacationDays.value, 10) : null,
        billingDay: (function() { var bd = document.getElementById('onb-billing-day'); return bd && bd.value ? parseInt(bd.value, 10) : null; })(),
        sickDayTracking: sickTracking ? sickTracking.checked : false,
        createdAt: (_jobs[_currentJobIndex] && _jobs[_currentJobIndex].createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      return job;
    }

    /**
     * Loads a job configuration into the Step 3 form fields.
     * @param {object} job - Job object to load
     */
    function _loadJobIntoForm(job) {
      var jobType = document.getElementById('onb-job-type');
      var employer = document.getElementById('onb-employer-name');
      var startDate = document.getElementById('onb-start-date');
      var hourlyRate = document.getElementById('onb-hourly-rate');
      var hourlyGroup = document.getElementById('onb-hourly-rate-group');
      var hasProvision = document.getElementById('onb-has-provision');
      var hasTips = document.getElementById('onb-has-tips');
      var vacationDays = document.getElementById('onb-vacation-days');
      var sickTracking = document.getElementById('onb-sick-tracking');

      if (jobType) jobType.value = job.type || '';
      if (employer) employer.value = job.employerName || '';
      if (startDate) startDate.value = job.startDate || '';

      // Website field
      var website = document.getElementById('onb-employer-website');
      if (website) website.value = job.website || '';

      // Salary type radios
      var salaryRadios = document.querySelectorAll('input[name="onb-salary-type"]');
      for (var i = 0; i < salaryRadios.length; i++) {
        salaryRadios[i].checked = (salaryRadios[i].value === job.salaryType);
      }

      // Show/hide hourly rate
      if (hourlyGroup) {
        hourlyGroup.style.display = (job.salaryType === 'hourly') ? '' : 'none';
      }
      if (hourlyRate) hourlyRate.value = job.defaultHourlyRate || '';

      // Optional toggles
      if (hasProvision) hasProvision.checked = job.hasProvision || false;
      if (hasTips) hasTips.checked = job.hasTipTracking || false;
      if (vacationDays) vacationDays.value = (job.vacationEntitlement !== null && job.vacationEntitlement !== undefined) ? job.vacationEntitlement : '';
      if (sickTracking) sickTracking.checked = job.sickDayTracking || false;
      var billingDayInput = document.getElementById('onb-billing-day');
      if (billingDayInput) billingDayInput.value = (job.billingDay !== null && job.billingDay !== undefined) ? job.billingDay : '';
    }

    /**
     * Resets the Step 3 form to empty state.
     */
    function _resetJobForm() {
      var jobType = document.getElementById('onb-job-type');
      var employer = document.getElementById('onb-employer-name');
      var startDate = document.getElementById('onb-start-date');
      var hourlyRate = document.getElementById('onb-hourly-rate');
      var hourlyGroup = document.getElementById('onb-hourly-rate-group');
      var hasProvision = document.getElementById('onb-has-provision');
      var hasTips = document.getElementById('onb-has-tips');
      var vacationDays = document.getElementById('onb-vacation-days');
      var sickTracking = document.getElementById('onb-sick-tracking');

      if (jobType) jobType.value = '';
      if (employer) employer.value = '';
      if (startDate) startDate.value = '';
      if (hourlyRate) hourlyRate.value = '';
      if (hourlyGroup) hourlyGroup.style.display = 'none';
      if (hasProvision) hasProvision.checked = false;
      if (hasTips) hasTips.checked = false;
      if (vacationDays) vacationDays.value = '';
      if (sickTracking) sickTracking.checked = false;

      // Reset salary type radios
      var salaryRadios = document.querySelectorAll('input[name="onb-salary-type"]');
      for (var i = 0; i < salaryRadios.length; i++) {
        salaryRadios[i].checked = false;
      }
    }

    /**
     * Updates the job step indicator label.
     */
    function _updateJobStepIndicator() {
      var label = document.getElementById('job-step-label');
      if (label) {
        if (_jobs.length <= 1 && _currentJobIndex === 0) {
          label.textContent = 'Job 1';
        } else {
          label.textContent = 'Job ' + (_currentJobIndex + 1) + ' von ' + Math.max(_jobs.length, _currentJobIndex + 1);
        }
      }
    }

    /**
     * Renders the list of already-configured jobs below the form.
     */
    function _renderConfiguredJobs() {
      var container = document.getElementById('onb-configured-jobs');
      if (!container) return;

      var html = '';
      for (var i = 0; i < _jobs.length; i++) {
        if (i === _currentJobIndex) continue; // Don't show the one being edited
        var job = _jobs[i];
        if (!job || !job.type) continue;
        html += '<div class="onb-job-chip">';
        html += '<span class="onb-job-chip-name">' + (job.employerName || 'Job ' + (i + 1)) + '</span>';
        html += '<span class="onb-job-chip-type">' + job.type + '</span>';
        html += '<button type="button" class="onb-job-chip-remove" data-index="' + i + '" aria-label="Job entfernen">✕</button>';
        html += '</div>';
      }
      container.innerHTML = html;

      // Bind remove buttons
      var removeBtns = container.querySelectorAll('.onb-job-chip-remove');
      for (var r = 0; r < removeBtns.length; r++) {
        removeBtns[r].addEventListener('click', function () {
          var idx = parseInt(this.getAttribute('data-index'), 10);
          _jobs.splice(idx, 1);
          _numJobs = _jobs.length || 1;
          if (_currentJobIndex >= _jobs.length) _currentJobIndex = Math.max(0, _jobs.length - 1);
          _renderConfiguredJobs();
          _updateJobTypeOptions();
          _updateJobStepIndicator();
        });
      }
    }

    /**
     * Job combination compatibility rules.
     * Returns an array of job types that are incompatible with the given set of existing types.
     */
    function _getIncompatibleTypes(existingTypes) {
      var incompatible = [];
      if (existingTypes.indexOf('Vollzeit') !== -1) {
        incompatible.push('Teilzeit', 'Vollzeit', 'Werkstudent');
      }
      if (existingTypes.indexOf('Teilzeit') !== -1) {
        incompatible.push('Vollzeit');
      }
      if (existingTypes.indexOf('Werkstudent') !== -1) {
        incompatible.push('Vollzeit');
      }
      return incompatible;
    }

    /**
     * Updates the job type dropdown to disable incompatible options.
     */
    function _updateJobTypeOptions() {
      var select = document.getElementById('onb-job-type');
      if (!select) return;

      // Get types of all OTHER configured jobs (not the current one being edited)
      var existingTypes = [];
      for (var i = 0; i < _jobs.length; i++) {
        if (i !== _currentJobIndex && _jobs[i] && _jobs[i].type) {
          existingTypes.push(_jobs[i].type);
        }
      }

      var incompatible = _getIncompatibleTypes(existingTypes);

      var options = select.querySelectorAll('option');
      for (var o = 0; o < options.length; o++) {
        var val = options[o].value;
        if (!val) continue; // Skip placeholder
        if (incompatible.indexOf(val) !== -1) {
          options[o].disabled = true;
          options[o].textContent = options[o].textContent.replace(/ \(nicht möglich\)$/, '') + ' (nicht möglich)';
        } else {
          options[o].disabled = false;
          options[o].textContent = options[o].textContent.replace(/ \(nicht möglich\)$/, '');
        }
      }
    }

    /**
     * Handles "Weiteren Job hinzufügen" button click.
     */
    function _onAddAnotherJob() {
      // Save current job first
      var validation = _validateStep3();
      if (!validation.valid) return;

      _jobs[_currentJobIndex] = _collectCurrentJob();

      // Add new empty job
      _currentJobIndex = _jobs.length;
      _jobs.push(null);
      _numJobs = _jobs.length;

      _resetJobForm();
      _updateJobStepIndicator();
      _renderConfiguredJobs();
      _updateJobTypeOptions();
      _clearErrors();
    }

    /**
     * Generates the review summary HTML for Step 4.
     * @returns {string} HTML string
     */
    function _generateReviewHTML() {
      var html = '';

      // Personal Data section
      html += '<div class="review-section">';
      html += '<h3 class="review-section-title">Persönliche Daten</h3>';
      html += '<dl class="review-list">';
      html += '<dt>Steuerklasse</dt><dd>' + (_personalData ? _personalData.steuerklasse : '—') + '</dd>';
      html += '<dt>Bundesland</dt><dd>' + (_personalData ? _personalData.bundesland : '—') + '</dd>';
      html += '<dt>Kirchensteuer</dt><dd>' + (_personalData && _personalData.kirchensteuer ? 'Ja' : 'Nein') + '</dd>';
      html += '<dt>Krankenversicherung</dt><dd>' + (_personalData ? _personalData.krankenversicherung : '—') + '</dd>';
      html += '</dl>';
      html += '</div>';

      // Jobs section
      html += '<div class="review-section">';
      html += '<h3 class="review-section-title">Jobs (' + _jobs.length + ')</h3>';
      for (var i = 0; i < _jobs.length; i++) {
        var job = _jobs[i];
        html += '<div class="review-job-card">';
        html += '<h4 class="review-job-title">Job ' + (i + 1) + ': ' + _escapeHTML(job.employerName) + '</h4>';
        html += '<dl class="review-list">';
        html += '<dt>Typ</dt><dd>' + _escapeHTML(job.type) + '</dd>';
        html += '<dt>Startdatum</dt><dd>' + _escapeHTML(job.startDate) + '</dd>';
        html += '<dt>Gehaltsart</dt><dd>' + (job.salaryType === 'hourly' ? 'Stundenlohn' : 'Festgehalt') + '</dd>';
        if (job.salaryType === 'hourly' && job.defaultHourlyRate !== null) {
          html += '<dt>Stundenlohn</dt><dd>' + job.defaultHourlyRate.toFixed(2) + ' €</dd>';
        }
        if (job.hasProvision) html += '<dt>Provision</dt><dd>Aktiviert</dd>';
        if (job.hasTipTracking) html += '<dt>Trinkgeld</dt><dd>Aktiviert</dd>';
        if (job.vacationEntitlement !== null && job.vacationEntitlement !== undefined) {
          html += '<dt>Urlaub</dt><dd>' + job.vacationEntitlement + ' Tage/Jahr</dd>';
        }
        if (job.sickDayTracking) html += '<dt>Krankheitstage</dt><dd>Aktiviert</dd>';
        html += '</dl>';
        html += '</div>';
      }
      html += '</div>';

      return html;
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHTML(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Public API ──

    /**
     * Starts the onboarding flow.
     */
    function start() {
      _started = true;
      _personalData = null;
      _numJobs = 1;
      _jobs = [];
      _currentJobIndex = 0;
      OnboardingNavigation.goToStep(1);
    }

    /**
     * Returns the current step number.
     * @returns {number}
     */
    function getCurrentStep() {
      return OnboardingNavigation.getCurrentStep();
    }

    /**
     * Navigates to a specific step.
     * @param {number} step
     */
    function goToStep(step) {
      if (step < 1 || step > OnboardingNavigation.TOTAL_STEPS) return;

      // If going to step 2 (job config), set up the job form
      if (step === 2) {
        _currentJobIndex = 0;
        _updateJobStepIndicator();
        if (_jobs[_currentJobIndex]) {
          _loadJobIntoForm(_jobs[_currentJobIndex]);
        } else {
          _resetJobForm();
        }
        _renderConfiguredJobs();
        _updateJobTypeOptions();
      }

      // If going to step 3 (review), generate review
      if (step === 3) {
        // Save current job if on step 2
        if (OnboardingNavigation.getCurrentStep() === 2) {
          _jobs[_currentJobIndex] = _collectCurrentJob();
          _numJobs = _jobs.length;
        }
        var reviewContent = document.getElementById('onboarding-review-content');
        if (reviewContent) {
          reviewContent.innerHTML = _generateReviewHTML();
        }
        _setError('error-onboarding-submit', '');
      }

      OnboardingNavigation.goToStep(step);
    }

    /**
     * Validates the current step.
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function validateCurrentStep() {
      var step = OnboardingNavigation.getCurrentStep();
      switch (step) {
        case 1: return _validateStep1();
        case 2: return _validateStep3(); // Job config validation (was step 3)
        case 3: return { valid: true, errors: [] }; // Review step
        default: return { valid: true, errors: [] };
      }
    }

    /**
     * Submits the onboarding data: persists to localStorage and navigates to dashboard.
     * @returns {{ success: boolean, error?: string }}
     */
    function submitOnboarding() {
      // Persist user profile
      var profileResult = AppState.setState('userProfile', _personalData);
      if (!profileResult.success) {
        _setError('error-onboarding-submit', 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
        _showRetryButton();
        return { success: false, error: 'persistence_failed' };
      }

      // Persist jobs array
      var jobsResult = AppState.setState('jobs', _jobs);
      if (!jobsResult.success) {
        _setError('error-onboarding-submit', 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
        _showRetryButton();
        return { success: false, error: 'persistence_failed' };
      }

      // Mark onboarding as complete via AppState
      var completeResult = AppState.setOnboardingComplete(true);
      if (!completeResult.success) {
        _setError('error-onboarding-submit', 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
        _showRetryButton();
        return { success: false, error: 'persistence_failed' };
      }

      // Persist schema version
      LocalStorageManager.save('jt_schema_version', LocalStorageManager.CURRENT_SCHEMA_VERSION);

      // Reload JobManager data so Tracking view sees the jobs
      JobManager.init();

      // Emit profile:updated so IncomeEngine can recalculate
      EventBus.emit('profile:updated', { profile: _personalData });

      // Emit job:created for each job so other modules can react
      for (var i = 0; i < _jobs.length; i++) {
        EventBus.emit('job:created', { job: _jobs[i] });
      }

      // Navigate to daily view
      _hideRetryButton();
      // Show bottom nav, enable nav tabs, and switch to daily view
      var bottomNav = document.querySelector('.bottom-nav');
      if (bottomNav) bottomNav.style.display = '';
      var tabs = document.querySelectorAll('.nav-tab');
      for (var j = 0; j < tabs.length; j++) {
        tabs[j].disabled = false;
        tabs[j].removeAttribute('aria-disabled');
      }
      NavigationController.switchTo('view-daily');

      // Force re-render of job cards after navigation completes to ensure
      // the daily view reflects newly created jobs from onboarding.
      // The lazy-init runs synchronously, but we use a short delay to ensure
      // the DOM is fully ready and any transition effects have settled.
      setTimeout(function() {
        if (typeof JobCardRenderer !== 'undefined' && JobCardRenderer.render) {
          JobCardRenderer.render();
        }
      }, 100);

      return { success: true };
    }

    /**
     * Returns whether onboarding has been completed.
     * @returns {boolean}
     */
    function isComplete() {
      return AppState.isOnboardingComplete();
    }

    /**
     * Shows the retry button on the review step.
     */
    function _showRetryButton() {
      var existing = document.getElementById('onb-retry-btn');
      if (existing) {
        existing.style.display = '';
        return;
      }

      var errorEl = document.getElementById('error-onboarding-submit');
      if (errorEl && errorEl.parentNode) {
        var retryBtn = document.createElement('button');
        retryBtn.id = 'onb-retry-btn';
        retryBtn.type = 'button';
        retryBtn.className = 'btn btn-primary';
        retryBtn.textContent = 'Erneut versuchen';
        retryBtn.style.marginTop = '12px';
        retryBtn.addEventListener('click', function () {
          submitOnboarding();
        });
        errorEl.parentNode.insertBefore(retryBtn, errorEl.nextSibling);
      }
    }

    /**
     * Hides the retry button.
     */
    function _hideRetryButton() {
      var retryBtn = document.getElementById('onb-retry-btn');
      if (retryBtn) {
        retryBtn.style.display = 'none';
      }
    }

    /**
     * Handles the 'onboarding:next' event — validates and advances.
     * @param {object} data - Event data with currentStep
     */
    function _handleNext(data) {
      var step = data.currentStep;
      var validation = validateCurrentStep();

      if (!validation.valid) {
        return;
      }

      // Collect data from current step before advancing
      if (step === 1) {
        _collectPersonalData();
      } else if (step === 2) {
        // Save current job
        _jobs[_currentJobIndex] = _collectCurrentJob();
        _numJobs = _jobs.length;
      }

      // If on last step, submit
      if (step === OnboardingNavigation.TOTAL_STEPS) {
        submitOnboarding();
        return;
      }

      // Advance to next step
      goToStep(step + 1);
    }

    /**
     * Handles the 'onboarding:back' event — navigates back.
     * @param {object} data - Event data with currentStep
     */
    function _handleBack(data) {
      var step = data.currentStep;

      if (step === 2) {
        // Save current job data before going back
        var partialJob = _collectCurrentJob();
        _jobs[_currentJobIndex] = partialJob;
      }

      if (step > 1) {
        goToStep(step - 1);
      }
    }

    /**
     * Initializes the OnboardingModule by subscribing to events.
     * If onboarding is already complete, does nothing.
     */
    function init() {
      // If onboarding is already complete, do nothing
      if (AppState.isOnboardingComplete()) {
        return;
      }

      EventBus.on('onboarding:next', _handleNext);
      EventBus.on('onboarding:back', _handleBack);

      // Bind "Weiteren Job hinzufügen" button
      var addJobBtn = document.getElementById('onb-add-another-job');
      if (addJobBtn) {
        addJobBtn.addEventListener('click', _onAddAnotherJob);
      }
    }

    return {
      start: start,
      getCurrentStep: getCurrentStep,
      goToStep: goToStep,
      validateCurrentStep: validateCurrentStep,
      submitOnboarding: submitOnboarding,
      isComplete: isComplete,
      init: init
    };
  })();

  // ─── EarningsExtraModule ──────────────────────────────────────────────────────
  // Handles provision and tip (Trinkgeld) tracking for jobs.
  // Design API: init(), addEarning(data), deleteEarning(id), getForJob(jobId, year, month?),
  //             getProvisionTotal(jobId, year, month?), getTipTotal(jobId, year, month?)
  const EarningsExtraModule = (function () {
    const STORAGE_KEY = 'jt_earnings_extra';
    const MIN_AMOUNT = 0.01;
    const MAX_AMOUNT = 99999.99;
    const VALID_TYPES = ['provision', 'tip'];

    /** @type {Array<object>} In-memory earnings array */
    var _earnings = [];

    // ── Helpers ──

    /**
     * Generates a UUID v4 using crypto.randomUUID() with a fallback.
     * @returns {string}
     */
    function _generateUUID() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    /**
     * Persists the in-memory earnings array to localStorage.
     * @returns {{ success: boolean, error?: string }}
     */
    function _persist() {
      var result = LocalStorageManager.save(STORAGE_KEY, _earnings);
      if (!result.success) {
        showToast('Speichern fehlgeschlagen. Änderungen sind im Speicher, konnten aber nicht gesichert werden.');
      }
      return result;
    }

    /**
     * Validates an EarningsExtraInput object.
     * @param {object} data - The input data to validate
     * @returns {{ valid: boolean, error?: string }}
     */
    function _validate(data) {
      if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Daten sind erforderlich.' };
      }

      // Validate type
      if (!data.type || VALID_TYPES.indexOf(data.type) === -1) {
        return { valid: false, error: 'Typ muss "provision" oder "tip" sein.' };
      }

      // Validate amount
      if (data.amount === null || data.amount === undefined || data.amount === '') {
        return { valid: false, error: 'Betrag ist erforderlich.' };
      }
      var num = parseFloat(data.amount);
      if (isNaN(num)) {
        return { valid: false, error: 'Betrag muss eine gültige Zahl sein.' };
      }
      if (num < MIN_AMOUNT) {
        return { valid: false, error: 'Betrag muss mindestens ' + MIN_AMOUNT.toFixed(2) + ' € betragen.' };
      }
      if (num > MAX_AMOUNT) {
        return { valid: false, error: 'Betrag darf ' + MAX_AMOUNT.toFixed(2) + ' € nicht überschreiten.' };
      }

      // Validate jobId
      if (!data.jobId || typeof data.jobId !== 'string') {
        return { valid: false, error: 'Job-ID ist erforderlich.' };
      }

      // Validate date
      if (!data.date || typeof data.date !== 'string') {
        return { valid: false, error: 'Datum ist erforderlich.' };
      }

      return { valid: true };
    }

    /**
     * Filters earnings by jobId, year, and optionally month.
     * @param {string} jobId
     * @param {number} year
     * @param {number} [month] - Optional month (1-12)
     * @returns {object[]}
     */
    function _filterByJobAndPeriod(jobId, year, month) {
      // Check if this job has a billing day — if so, filter by billing period
      var jobs = AppState.getState().jobs;
      var job = null;
      for (var j = 0; j < jobs.length; j++) {
        if (jobs[j].id === jobId) { job = jobs[j]; break; }
      }

      if (job && job.billingDay && month !== undefined && month !== null) {
        // Use billing period: previous month's (billingDay+1) to this month's billingDay
        var prevMonth = month - 1;
        var prevYear = year;
        if (prevMonth < 1) { prevMonth = 12; prevYear--; }
        var startDay = job.billingDay + 1;
        var daysInPrev = new Date(prevYear, prevMonth, 0).getDate();
        if (startDay > daysInPrev) startDay = daysInPrev;
        var endDay = Math.min(job.billingDay, new Date(year, month, 0).getDate());
        var startDate = prevYear + '-' + String(prevMonth).padStart(2, '0') + '-' + String(startDay).padStart(2, '0');
        var endDate = year + '-' + String(month).padStart(2, '0') + '-' + String(endDay).padStart(2, '0');

        return _earnings.filter(function (entry) {
          if (entry.jobId !== jobId) return false;
          if (!entry.date) return false;
          return entry.date >= startDate && entry.date <= endDate;
        });
      }

      // Standard calendar month filtering
      return _earnings.filter(function (entry) {
        if (entry.jobId !== jobId) return false;
        if (!entry.date) return false;
        var parts = entry.date.split('-');
        var entryYear = parseInt(parts[0], 10);
        if (entryYear !== year) return false;
        if (month !== undefined && month !== null) {
          var entryMonth = parseInt(parts[1], 10);
          if (entryMonth !== month) return false;
        }
        return true;
      });
    }

    // ── Public API ──

    /**
     * Initializes the module by loading earnings from LocalStorageManager.
     */
    function init() {
      var result = LocalStorageManager.load(STORAGE_KEY);
      if (result.success && Array.isArray(result.data)) {
        _earnings = result.data;
      } else {
        _earnings = [];
      }
    }

    /**
     * Adds a new earning entry (provision or tip).
     * Validates amount (0.01–99999.99) and type (provision/tip).
     * Generates UUID, adds timestamps, persists, and emits earnings:saved.
     * @param {object} data - EarningsExtraInput { jobId, workdayId?, type, amount, date, note? }
     * @returns {{ success: boolean, error?: string }}
     */
    function addEarning(data) {
      var validation = _validate(data);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      var now = new Date().toISOString();
      var entry = {
        id: _generateUUID(),
        jobId: data.jobId,
        workdayId: data.workdayId || null,
        type: data.type,
        amount: parseFloat(parseFloat(data.amount).toFixed(2)),
        date: data.date,
        note: data.note || null,
        createdAt: now,
        updatedAt: now
      };

      _earnings.push(entry);
      var result = _persist();

      if (!result.success) {
        // Rollback in-memory change
        _earnings.pop();
        return { success: false, error: 'Speichern fehlgeschlagen.' };
      }

      EventBus.emit('earnings:saved', { entry: entry });

      return { success: true };
    }

    /**
     * Deletes an earnings entry by ID.
     * Removes from array, persists, and emits earnings:deleted.
     * @param {string} id - The entry ID to delete
     * @returns {{ success: boolean, error?: string }}
     */
    function deleteEarning(id) {
      var index = -1;
      for (var i = 0; i < _earnings.length; i++) {
        if (_earnings[i].id === id) {
          index = i;
          break;
        }
      }

      if (index === -1) {
        return { success: false, error: 'Eintrag nicht gefunden.' };
      }

      var deleted = _earnings.splice(index, 1)[0];
      var result = _persist();

      if (!result.success) {
        // Rollback in-memory change
        _earnings.splice(index, 0, deleted);
        return { success: false, error: 'Speichern fehlgeschlagen.' };
      }

      EventBus.emit('earnings:deleted', { id: deleted.id, jobId: deleted.jobId });

      return { success: true };
    }

    /**
     * Returns all earnings entries for a given job, year, and optionally month.
     * @param {string} jobId - The job ID
     * @param {number} year - The year
     * @param {number} [month] - Optional month (1-12)
     * @returns {object[]} Array of EarningsExtra entries
     */
    function getForJob(jobId, year, month) {
      return _filterByJobAndPeriod(jobId, year, month);
    }

    /**
     * Returns the sum of provision amounts for a given job, year, and optionally month.
     * @param {string} jobId - The job ID
     * @param {number} year - The year
     * @param {number} [month] - Optional month (1-12)
     * @returns {number} Total provision amount
     */
    function getProvisionTotal(jobId, year, month) {
      var entries = _filterByJobAndPeriod(jobId, year, month);
      var total = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].type === 'provision') {
          total += entries[i].amount;
        }
      }
      return parseFloat(total.toFixed(2));
    }

    /**
     * Returns the sum of tip amounts for a given job, year, and optionally month.
     * @param {string} jobId - The job ID
     * @param {number} year - The year
     * @param {number} [month] - Optional month (1-12)
     * @returns {number} Total tip amount
     */
    function getTipTotal(jobId, year, month) {
      var entries = _filterByJobAndPeriod(jobId, year, month);
      var total = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].type === 'tip') {
          total += entries[i].amount;
        }
      }
      return parseFloat(total.toFixed(2));
    }

    return {
      init: init,
      addEarning: addEarning,
      deleteEarning: deleteEarning,
      getForJob: getForJob,
      getProvisionTotal: getProvisionTotal,
      getTipTotal: getTipTotal
    };
  })();

  // ─── IncomeEngine ─────────────────────────────────────────────────────────────
  // Calculates gross (Brutto) and net (Netto) income per job type using RuleConfigEngine parameters.
  // Subscribes to workday:saved, workday:deleted, job:updated, profile:updated, earnings:saved,
  // earnings:deleted events and emits income:updated after recalculation.
  // Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 9.5
  const IncomeEngine = (function () {

    // ── Helpers ──

    /**
     * Returns the billing period date range for a job.
     * If billingDay is set (e.g. 20), the period for "month M" runs from
     * day (billingDay+1) of month M-1 to day billingDay of month M.
     * If billingDay is null, uses standard calendar month (1st to last day).
     * @param {object} job - Job object with optional billingDay
     * @param {number} year - Target year
     * @param {number} month - Target month (1-12)
     * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD strings
     */
    function _getBillingPeriod(job, year, month) {
      var billingDay = job && job.billingDay ? job.billingDay : null;
      if (!billingDay) {
        // Standard calendar month
        var lastDay = new Date(year, month, 0).getDate();
        var start = year + '-' + String(month).padStart(2, '0') + '-01';
        var end = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
        return { startDate: start, endDate: end };
      }
      // Custom billing period: previous month's (billingDay+1) to this month's billingDay
      var prevMonth = month - 1;
      var prevYear = year;
      if (prevMonth < 1) { prevMonth = 12; prevYear--; }
      var startDay = billingDay + 1;
      var daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate();
      if (startDay > daysInPrevMonth) startDay = daysInPrevMonth;
      var endDay = Math.min(billingDay, new Date(year, month, 0).getDate());
      var start = prevYear + '-' + String(prevMonth).padStart(2, '0') + '-' + String(startDay).padStart(2, '0');
      var end = year + '-' + String(month).padStart(2, '0') + '-' + String(endDay).padStart(2, '0');
      return { startDate: start, endDate: end };
    }

    /**
     * Returns the current billing month/year for a job based on today's date.
     * If today is after the billingDay, we're in the NEXT month's billing period.
     * @param {object} job
     * @returns {{ year: number, month: number }}
     */
    function _getCurrentBillingMonth(job) {
      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth() + 1;
      var day = now.getDate();
      var billingDay = job && job.billingDay ? job.billingDay : null;
      if (billingDay && day > billingDay) {
        // We're past the billing day, so this counts as next month
        month++;
        if (month > 12) { month = 1; year++; }
      }
      return { year: year, month: month };
    }

    /**
     * Finds a job by ID from AppState.
     * @param {string} jobId
     * @returns {object|null}
     */
    function _findJob(jobId) {
      var jobs = AppState.getState().jobs;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === jobId) return jobs[i];
      }
      return null;
    }

    /**
     * Returns workday entries for a given job, year, and month.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {object[]}
     */
    function _getWorkdaysForMonth(jobId, year, month) {
      var job = _findJob(jobId);
      var workdays = AppState.getState().workdays;

      // If job has a custom billing day, filter by billing period date range
      if (job && job.billingDay) {
        var period = _getBillingPeriod(job, year, month);
        return workdays.filter(function (w) {
          return w.jobId === jobId && w.date && w.date >= period.startDate && w.date <= period.endDate;
        });
      }

      // Standard calendar month
      var prefix = year + '-' + String(month).padStart(2, '0');
      return workdays.filter(function (w) {
        return w.jobId === jobId && w.date && w.date.startsWith(prefix);
      });
    }

    /**
     * Returns workday entries for a given job and year.
     * @param {string} jobId
     * @param {number} year
     * @returns {object[]}
     */
    function _getWorkdaysForYear(jobId, year) {
      var workdays = AppState.getState().workdays;
      var prefix = String(year) + '-';
      return workdays.filter(function (w) {
        return w.jobId === jobId && w.date && w.date.startsWith(prefix);
      });
    }

    /**
     * Calculates the number of paid sick leave days for a given month,
     * respecting the 42 consecutive calendar days per illness episode limit.
     * Only days with status "sick" AND paidSickLeave: true are counted.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {number} Number of qualifying paid sick days in this month
     */
    function _getPaidSickDaysForMonth(jobId, year, month) {
      // Get ALL sick days for this job to determine consecutive episodes
      var allWorkdays = AppState.getState().workdays;
      var sickDays = allWorkdays.filter(function (w) {
        return w.jobId === jobId && w.status === 'sick' && w.paidSickLeave === true && w.date;
      });

      if (sickDays.length === 0) return 0;

      // Sort by date
      sickDays.sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });

      // Group into consecutive illness episodes (42 calendar day limit per episode)
      // An episode is a sequence of sick days where consecutive days are no more than
      // 1 calendar day apart. We track consecutive calendar days (not just work days).
      var qualifyingDaysInMonth = 0;
      var targetPrefix = year + '-' + String(month).padStart(2, '0');

      var episodeStart = null;
      var episodeDayCount = 0;

      for (var i = 0; i < sickDays.length; i++) {
        var currentDate = sickDays[i].date;
        var currentDateObj = new Date(currentDate + 'T00:00:00');

        if (episodeStart === null) {
          // Start a new episode
          episodeStart = currentDateObj;
          episodeDayCount = 1;
        } else {
          // Calculate calendar days from episode start to current date
          var prevDate = new Date(sickDays[i - 1].date + 'T00:00:00');
          var daysBetween = Math.round((currentDateObj - prevDate) / (1000 * 60 * 60 * 24));

          if (daysBetween <= 1) {
            // Continuation of the same episode
            var calendarDaysFromStart = Math.round((currentDateObj - episodeStart) / (1000 * 60 * 60 * 24)) + 1;
            episodeDayCount = calendarDaysFromStart;
          } else {
            // New episode — reset
            episodeStart = currentDateObj;
            episodeDayCount = 1;
          }
        }

        // Check if this day is within the 42-day limit and in the target month
        if (episodeDayCount <= 42 && currentDate.startsWith(targetPrefix)) {
          qualifyingDaysInMonth++;
        }
      }

      return qualifyingDaysInMonth;
    }

    /**
     * Emits the income:updated event with current totals for a given job.
     * Called after any recalculation triggered by EventBus events.
     * @param {string} [jobId] - If provided, includes per-job data; otherwise aggregated
     */
    function _emitIncomeUpdated(jobId) {
      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth() + 1;

      var payload = { year: year, month: month };

      if (jobId) {
        payload.jobId = jobId;
        payload.monthly = {
          brutto: calculateMonthlyBrutto(jobId, year, month),
          netto: calculateMonthlyNetto(jobId, year, month)
        };
        payload.yearly = {
          brutto: calculateYearlyBrutto(jobId, year),
          netto: calculateYearlyNetto(jobId, year)
        };
      }

      EventBus.emit('income:updated', payload);
    }

    /**
     * Handles recalculation when a workday is saved or deleted.
     * @param {object} data - Event payload with entry or jobId
     */
    function _onWorkdayChange(data) {
      var jobId = data && (data.jobId || (data.entry && data.entry.jobId));
      if (jobId) {
        _emitIncomeUpdated(jobId);
      }
    }

    /**
     * Handles recalculation when a job is updated.
     * @param {object} data - Event payload with job
     */
    function _onJobUpdated(data) {
      var jobId = data && (data.job && data.job.id || data.jobId);
      if (jobId) {
        _emitIncomeUpdated(jobId);
      }
    }

    /**
     * Handles recalculation when the user profile is updated (Steuerklasse, Bundesland, etc.).
     * Recalculates all Teilzeit/Vollzeit jobs.
     */
    function _onProfileUpdated() {
      var jobs = AppState.getState().jobs;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].type === 'Teilzeit' || jobs[i].type === 'Vollzeit') {
          _emitIncomeUpdated(jobs[i].id);
        }
      }
    }

    /**
     * Handles recalculation when earnings (provision/tip) are saved or deleted.
     * @param {object} data - Event payload with jobId
     */
    function _onEarningsChange(data) {
      var jobId = data && (data.jobId || (data.entry && data.entry.jobId));
      if (jobId) {
        _emitIncomeUpdated(jobId);
      }
    }

    /**
     * Returns the total provision amount for a job in a given year and optional month.
     * @param {string} jobId
     * @param {number} year
     * @param {number} [month] - 1-12 (optional; if omitted, returns yearly total)
     * @returns {number}
     */
    function getProvisionTotal(jobId, year, month) {
      return EarningsExtraModule.getProvisionTotal(jobId, year, month);
    }

    /**
     * Returns the total tip (Trinkgeld) amount for a job in a given year and optional month.
     * Tips are excluded from brutto but tracked separately.
     * @param {string} jobId
     * @param {number} year
     * @param {number} [month] - 1-12 (optional; if omitted, returns yearly total)
     * @returns {number}
     */
    function getTipTotal(jobId, year, month) {
      return EarningsExtraModule.getTipTotal(jobId, year, month);
    }

    /**
     * Calculates monthly Brutto for a given job.
     * - Hourly jobs: sum(hours × applicable rate per day) + provisions + paid sick leave
     * - Fixed-salary jobs: fixedMonthlySalary + overtime + provisions + paid sick leave
     * Rounds to 2 decimal places.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {number}
     */
    function calculateMonthlyBrutto(jobId, year, month) {
      var job = _findJob(jobId);
      if (!job) return 0.00;

      var workdays = _getWorkdaysForMonth(jobId, year, month);
      var provisions = getProvisionTotal(jobId, year, month);

      var brutto = 0;

      if (job.salaryType === 'hourly') {
        // Sum (hours × applicable rate) for each worked day
        for (var i = 0; i < workdays.length; i++) {
          var entry = workdays[i];
          if (entry.status === 'worked' && entry.hours) {
            var rate = (entry.hourlyRateOverride !== null && entry.hourlyRateOverride !== undefined)
              ? entry.hourlyRateOverride
              : job.defaultHourlyRate;
            brutto += entry.hours * rate;
          }
        }
      } else if (job.salaryType === 'fixed') {
        // Fixed monthly salary
        brutto = job.fixedMonthlySalary || 0;

        // Overtime calculation: hours beyond standardHoursPerDay × standardDaysPerWeek × 4.33 weeks
        if (job.standardHoursPerDay && job.standardDaysPerWeek && job.defaultHourlyRate) {
          var standardMonthlyHours = job.standardHoursPerDay * job.standardDaysPerWeek * 4.33;
          var totalWorkedHours = 0;
          for (var j = 0; j < workdays.length; j++) {
            if (workdays[j].status === 'worked' && workdays[j].hours) {
              totalWorkedHours += workdays[j].hours;
            }
          }
          var overtimeHours = totalWorkedHours - standardMonthlyHours;
          if (overtimeHours > 0) {
            brutto += overtimeHours * job.defaultHourlyRate;
          }
        }
      }

      // Add paid sick leave (Lohnfortzahlung)
      // Only when WorkDay has status: "sick" AND paidSickLeave: true
      // Calculate as standardHoursPerDay × defaultHourlyRate per qualifying sick day
      if (job.standardHoursPerDay && job.defaultHourlyRate) {
        var paidSickDays = _getPaidSickDaysForMonth(jobId, year, month);
        brutto += paidSickDays * job.standardHoursPerDay * job.defaultHourlyRate;
      }

      // Add provisions to brutto (tips are excluded)
      brutto += provisions;

      // Round to 2 decimal places
      return Math.round(brutto * 100) / 100;
    }

    /**
     * Calculates yearly Brutto for a given job (sum of all monthly brutto values).
     * @param {string} jobId
     * @param {number} year
     * @returns {number}
     */
    function calculateYearlyBrutto(jobId, year) {
      var total = 0;
      for (var m = 1; m <= 12; m++) {
        total += calculateMonthlyBrutto(jobId, year, m);
      }
      return Math.round(total * 100) / 100;
    }

    // ── Netto Calculation Helpers ──

    /**
     * Simplified German income tax approximation using Steuerklasse-based effective rates.
     * Uses a simplified progressive rate based on Steuerklasse:
     * - Steuerklasse I: ~14% effective rate on monthly income above 1000€
     * - Steuerklasse II: ~12% effective rate
     * - Steuerklasse III: ~8% effective rate
     * - Steuerklasse IV: ~14% effective rate
     * - Steuerklasse V: ~20% effective rate
     * - Steuerklasse VI: ~25% effective rate
     *
     * @param {number} monthlyBrutto - Monthly gross income
     * @param {number} steuerklasse - Tax class (1-6)
     * @returns {number} Monthly income tax amount
     */
    function _calculateIncomeTax(monthlyBrutto, steuerklasse) {
      // Simplified progressive tax calculation per Steuerklasse.
      // Thresholds represent the monthly Grundfreibetrag (tax-free allowance) per class.
      // Steuerklasse V and VI have no/very low threshold.
      var thresholds = {
        1: 1029,   // Grundfreibetrag €12,348/Jahr
        2: 1384,   // (€12,348 + €4,260 Entlastungsbetrag Alleinerziehende) / 12
        3: 2058,   // Doppelter Grundfreibetrag (Ehepartner)
        4: 1029,   // Wie Klasse I
        5: 0,      // Kein Freibetrag
        6: 0       // Kein Freibetrag
      };
      var effectiveRates = {
        1: 0.20,
        2: 0.18,
        3: 0.12,
        4: 0.20,
        5: 0.30,
        6: 0.35
      };

      var threshold = thresholds[steuerklasse] !== undefined ? thresholds[steuerklasse] : 950;
      var rate = effectiveRates[steuerklasse] || 0.18;

      // Tax only applies on income above the threshold
      var taxableIncome = monthlyBrutto - threshold;
      if (taxableIncome <= 0) return 0;

      var monthlyTax = taxableIncome * rate;
      return Math.round(monthlyTax * 100) / 100;
    }

    /**
     * Calculates Solidaritätszuschlag (solidarity surcharge).
     * 5.5% of income tax, but only if income tax exceeds the Freigrenze.
     * Freigrenze for 2026: ~18,130€ annual tax (single) / ~36,260€ (married/Steuerklasse 3).
     * Below the Freigrenze, no Soli is charged.
     *
     * @param {number} monthlyIncomeTax - Monthly income tax amount
     * @param {number} steuerklasse - Tax class (1-6)
     * @param {number} soliRate - Solidarity surcharge rate (e.g. 0.055)
     * @returns {number} Monthly Solidaritätszuschlag
     */
    function _calculateSoli(monthlyIncomeTax, steuerklasse, soliRate) {
      // Annual income tax
      var annualTax = monthlyIncomeTax * 12;

      // Freigrenze (below this, no Soli is charged)
      var freigrenze = 18130; // Single
      if (steuerklasse === 3) {
        freigrenze = 36260; // Married
      }

      if (annualTax <= freigrenze) {
        return 0;
      }

      // Soli is 5.5% of income tax (with a Milderungszone near the Freigrenze,
      // simplified here as full 5.5% once above Freigrenze)
      var monthlySoli = monthlyIncomeTax * soliRate;
      return Math.round(monthlySoli * 100) / 100;
    }

    /**
     * Calculates Kirchensteuer (church tax).
     * Applied as a percentage of income tax (8% in Bayern/Baden-Württemberg, 9% elsewhere).
     *
     * @param {number} monthlyIncomeTax - Monthly income tax amount
     * @param {number} kirchensteuerRate - Rate (0.08 or 0.09)
     * @returns {number} Monthly Kirchensteuer
     */
    function _calculateKirchensteuer(monthlyIncomeTax, kirchensteuerRate) {
      var tax = monthlyIncomeTax * kirchensteuerRate;
      return Math.round(tax * 100) / 100;
    }

    /**
     * Determines the Kirchensteuer rate based on Bundesland.
     * Bayern and Baden-Württemberg use 8%, all other states use 9%.
     *
     * @param {string} bundesland
     * @returns {number} Rate (0.08 or 0.09)
     */
    function _getKirchensteuerRateForBundesland(bundesland) {
      var lower = (bundesland || '').toLowerCase();
      if (lower === 'bayern' || lower === 'baden-württemberg' || lower === 'baden-wuerttemberg') {
        return 0.08;
      }
      return 0.09;
    }

    /**
     * Calculates monthly Netto for a given job.
     *
     * Job-type-specific deduction logic:
     * - Minijob: flat-rate taxation by employer, no employee deduction (netto ≈ brutto)
     * - KFB: flat-rate by employer, no employee deduction (netto ≈ brutto)
     * - Werkstudent: only pension insurance (9.3% employee share), exempt from health/care/unemployment
     * - Teilzeit/Vollzeit: full income tax + Soli + Kirchensteuer (if enabled) + all social insurance
     *
     * Returns { netto, available, reason? }:
     * - available: true when calculation can be performed
     * - available: false with reason when Steuerklasse or Bundesland is missing (Teilzeit/Vollzeit only)
     *
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {{ netto: number, available: boolean, reason?: string }}
     */
    function calculateMonthlyNetto(jobId, year, month) {
      var job = _findJob(jobId);
      if (!job) return { netto: 0, available: true };

      var brutto = calculateMonthlyBrutto(jobId, year, month);
      var config = RuleConfigEngine.getConfig(year);
      var userProfile = AppState.getState().userProfile;

      // ── Minijob: AN-Eigenanteil Rentenversicherung 3,6% (Aufstockung auf 18,6%) ──
      // Standardmäßig rentenversicherungspflichtig, keine Lohnsteuer, keine KV/PV/AV
      if (job.type === 'Minijob') {
        var minijobRVRate = 0.036; // 3,6% AN-Eigenanteil
        var minijobRV = brutto * minijobRVRate;
        var minijobNetto = brutto - minijobRV;
        return {
          netto: Math.round(minijobNetto * 100) / 100,
          available: true,
          deductions: {
            pension: Math.round(minijobRV * 100) / 100,
            health: 0,
            care: 0,
            unemployment: 0,
            incomeTax: 0,
            soli: 0,
            kirchensteuer: 0,
            total: Math.round(minijobRV * 100) / 100
          }
        };
      }

      // ── KFB: Pauschale Lohnsteuer 25% + Soli + ggf. Kirchensteuer ──
      // Bei kurzfristiger Beschäftigung wird in der Regel pauschal 25% Lohnsteuer
      // vom Arbeitgeber einbehalten (§ 40a Abs. 1 EStG), die auf den AN umgelegt wird.
      // Zusätzlich: Soli (5,5% auf Lohnsteuer) und ggf. Kirchensteuer.
      if (job.type === 'KFB') {
        var kfbPauschalRate = 0.25; // 25% pauschale Lohnsteuer
        var kfbIncomeTax = brutto * kfbPauschalRate;
        var kfbSoliRate = config.solidaritaetszuschlag; // 5,5%
        var kfbSoli = kfbIncomeTax * kfbSoliRate;
        var kfbKirchensteuer = 0;
        if (userProfile && userProfile.kirchensteuer) {
          var kfbKSRate = _getKirchensteuerRateForBundesland(
            userProfile && userProfile.bundesland ? userProfile.bundesland : ''
          );
          kfbKirchensteuer = kfbIncomeTax * kfbKSRate;
        }
        var kfbTotalDeductions = kfbIncomeTax + kfbSoli + kfbKirchensteuer;
        var kfbNetto = brutto - kfbTotalDeductions;
        if (kfbNetto < 0) kfbNetto = 0;
        return {
          netto: Math.round(kfbNetto * 100) / 100,
          available: true,
          deductions: {
            pension: 0,
            health: 0,
            care: 0,
            unemployment: 0,
            incomeTax: Math.round(kfbIncomeTax * 100) / 100,
            soli: Math.round(kfbSoli * 100) / 100,
            kirchensteuer: Math.round(kfbKirchensteuer * 100) / 100,
            total: Math.round(kfbTotalDeductions * 100) / 100
          }
        };
      }

      // ── Werkstudent: only pension insurance deduction ──
      if (job.type === 'Werkstudent') {
        var pensionRate = config.socialInsuranceRates.pension; // 9.3%
        var pensionDeduction = brutto * pensionRate;
        var werkstudentNetto = brutto - pensionDeduction;
        return {
          netto: Math.round(werkstudentNetto * 100) / 100,
          available: true,
          deductions: {
            pension: Math.round(pensionDeduction * 100) / 100,
            health: 0,
            care: 0,
            unemployment: 0,
            incomeTax: 0,
            soli: 0,
            kirchensteuer: 0,
            total: Math.round(pensionDeduction * 100) / 100
          }
        };
      }

      // ── Teilzeit / Vollzeit: full tax + social insurance ──
      // Requires Steuerklasse AND Bundesland to be present
      if (!userProfile || !userProfile.steuerklasse || !userProfile.bundesland) {
        return { netto: 0, available: false, reason: 'missing tax data' };
      }

      var steuerklasse = userProfile.steuerklasse;
      var bundesland = userProfile.bundesland;

      // Determine Kirchensteuer: use profile value if present, default to false
      var kirchensteuerEnabled = (userProfile.kirchensteuer !== undefined && userProfile.kirchensteuer !== null)
        ? userProfile.kirchensteuer
        : false;

      // Determine KV-Typ: use profile value if present, default to "gesetzlich"
      var kvTyp = (userProfile.krankenversicherung)
        ? userProfile.krankenversicherung
        : 'gesetzlich';

      // 1. Social insurance contributions
      var socialRates = config.socialInsuranceRates;
      var pensionContrib = brutto * socialRates.pension;       // 9.3%
      var healthContrib = 0;
      var careContrib = 0;
      var unemploymentContrib = brutto * socialRates.unemployment; // 1.3%

      // Health insurance: only for gesetzlich (private insurance is not deducted from brutto)
      if (kvTyp === 'gesetzlich') {
        healthContrib = brutto * socialRates.health;           // 8.75% (7.3% + avg 1.45% Zusatzbeitrag)
        // Pflegeversicherung: 1.8% with children, 2.4% childless (23+)
        // Sachsen: +0.5% extra employee share
        var careRate = socialRates.care; // 1.8% default (with children)
        if (userProfile && !userProfile.hasChildren) {
          careRate = socialRates.careChildless; // 2.4% for childless
        }
        // Sachsen special: employee pays 0.5% more
        if (bundesland === 'Sachsen') {
          careRate += 0.005;
        }
        careContrib = brutto * careRate;
      }

      var totalSocialDeductions = pensionContrib + healthContrib + careContrib + unemploymentContrib;

      // 2. Income tax (on brutto minus social insurance — simplified: tax on full brutto)
      // Note: In reality, certain deductions reduce taxable income. For this approximation,
      // we calculate tax on the full monthly brutto.
      var monthlyIncomeTax = _calculateIncomeTax(brutto, steuerklasse);

      // 3. Solidaritätszuschlag
      var soliRate = config.solidaritaetszuschlag; // 0.055
      var monthlySoli = _calculateSoli(monthlyIncomeTax, steuerklasse, soliRate);

      // 4. Kirchensteuer (if enabled)
      var monthlyKirchensteuer = 0;
      if (kirchensteuerEnabled) {
        var ksRate = _getKirchensteuerRateForBundesland(bundesland);
        monthlyKirchensteuer = _calculateKirchensteuer(monthlyIncomeTax, ksRate);
      }

      // Total deductions
      var totalDeductions = totalSocialDeductions + monthlyIncomeTax + monthlySoli + monthlyKirchensteuer;

      // Netto = Brutto - all deductions
      var netto = brutto - totalDeductions;
      // Netto should not go below 0
      if (netto < 0) netto = 0;

      return {
        netto: Math.round(netto * 100) / 100,
        available: true,
        deductions: {
          pension: Math.round(pensionContrib * 100) / 100,
          health: Math.round(healthContrib * 100) / 100,
          care: Math.round(careContrib * 100) / 100,
          unemployment: Math.round(unemploymentContrib * 100) / 100,
          incomeTax: Math.round(monthlyIncomeTax * 100) / 100,
          soli: Math.round(monthlySoli * 100) / 100,
          kirchensteuer: Math.round(monthlyKirchensteuer * 100) / 100,
          total: Math.round(totalDeductions * 100) / 100
        }
      };
    }

    /**
     * Calculates yearly Netto for a given job (sum of all monthly netto values).
     * If any month returns available: false, the yearly result is also unavailable.
     *
     * @param {string} jobId
     * @param {number} year
     * @returns {{ netto: number, available: boolean, reason?: string }}
     */
    function calculateYearlyNetto(jobId, year) {
      var total = 0;
      for (var m = 1; m <= 12; m++) {
        var monthResult = calculateMonthlyNetto(jobId, year, m);
        if (!monthResult.available) {
          return { netto: 0, available: false, reason: monthResult.reason };
        }
        total += monthResult.netto;
      }
      return { netto: Math.round(total * 100) / 100, available: true };
    }

    /**
     * Calculates hours, working days, vacation days, and sick days for a job in a month.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {{ hours: number, workingDays: number, vacationDays: number, sickDays: number }}
     */
    function _getJobMonthStats(jobId, year, month) {
      var workdays = _getWorkdaysForMonth(jobId, year, month);
      var hours = 0;
      var workingDays = 0;
      var vacationDays = 0;
      var sickDays = 0;

      for (var i = 0; i < workdays.length; i++) {
        var entry = workdays[i];
        if (entry.status === 'worked') {
          workingDays++;
          if (entry.hours) hours += entry.hours;
        } else if (entry.status === 'vacation') {
          vacationDays++;
        } else if (entry.status === 'sick') {
          sickDays++;
        }
      }

      return {
        hours: Math.round(hours * 100) / 100,
        workingDays: workingDays,
        vacationDays: vacationDays,
        sickDays: sickDays
      };
    }

    /**
     * Calculates hours, working days, vacation days, and sick days for a job in a year.
     * @param {string} jobId
     * @param {number} year
     * @returns {{ hours: number, workingDays: number, vacationDays: number, sickDays: number }}
     */
    function _getJobYearStats(jobId, year) {
      var workdays = _getWorkdaysForYear(jobId, year);
      var hours = 0;
      var workingDays = 0;
      var vacationDays = 0;
      var sickDays = 0;

      for (var i = 0; i < workdays.length; i++) {
        var entry = workdays[i];
        if (entry.status === 'worked') {
          workingDays++;
          if (entry.hours) hours += entry.hours;
        } else if (entry.status === 'vacation') {
          vacationDays++;
        } else if (entry.status === 'sick') {
          sickDays++;
        }
      }

      return {
        hours: Math.round(hours * 100) / 100,
        workingDays: workingDays,
        vacationDays: vacationDays,
        sickDays: sickDays
      };
    }

    /**
     * Returns aggregated monthly totals across all jobs.
     * Returns both the AggregateTotals shape and backward-compatible fields.
     *
     * AggregateTotals shape:
     * { hours, brutto, netto, provision, tips, vacationDays, sickDays, workingDays }
     *
     * Tips (Trinkgeld) are added to the final netto cashflow display but do NOT affect brutto.
     *
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {object} AggregateTotals with backward-compatible fields
     */
    function getAggregatedMonthly(year, month) {
      var jobs = AppState.getState().jobs;
      var totalBrutto = 0;
      var totalNetto = 0;
      var totalTips = 0;
      var totalProvision = 0;
      var totalHours = 0;
      var totalWorkingDays = 0;
      var totalVacationDays = 0;
      var totalSickDays = 0;
      var nettoAvailable = true;
      var perJob = [];

      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        var brutto = calculateMonthlyBrutto(job.id, year, month);
        var nettoResult = calculateMonthlyNetto(job.id, year, month);
        var tips = getTipTotal(job.id, year, month);
        var provisions = getProvisionTotal(job.id, year, month);
        var stats = _getJobMonthStats(job.id, year, month);

        totalBrutto += brutto;
        totalTips += tips;
        totalProvision += provisions;
        totalHours += stats.hours;
        totalWorkingDays += stats.workingDays;
        totalVacationDays += stats.vacationDays;
        totalSickDays += stats.sickDays;

        if (nettoResult.available) {
          totalNetto += nettoResult.netto;
        } else {
          nettoAvailable = false;
        }

        perJob.push({
          jobId: job.id,
          employerName: job.employerName,
          type: job.type,
          brutto: brutto,
          netto: nettoResult.available ? nettoResult.netto : null,
          nettoAvailable: nettoResult.available,
          tips: tips,
          provisions: provisions
        });
      }

      // Netto cashflow = total netto + tips
      var nettoCashflow = totalNetto + totalTips;

      return {
        // AggregateTotals shape
        hours: Math.round(totalHours * 100) / 100,
        brutto: Math.round(totalBrutto * 100) / 100,
        netto: Math.round(totalNetto * 100) / 100,
        provision: Math.round(totalProvision * 100) / 100,
        tips: Math.round(totalTips * 100) / 100,
        vacationDays: totalVacationDays,
        sickDays: totalSickDays,
        workingDays: totalWorkingDays,
        // Backward-compatible fields
        totalBrutto: Math.round(totalBrutto * 100) / 100,
        totalNetto: Math.round(totalNetto * 100) / 100,
        totalTips: Math.round(totalTips * 100) / 100,
        nettoCashflow: Math.round(nettoCashflow * 100) / 100,
        nettoAvailable: nettoAvailable,
        perJob: perJob
      };
    }

    /**
     * Returns aggregated yearly totals across all jobs.
     * Returns both the AggregateTotals shape and backward-compatible fields.
     *
     * AggregateTotals shape:
     * { hours, brutto, netto, provision, tips, vacationDays, sickDays, workingDays }
     *
     * Tips (Trinkgeld) are added to the final netto cashflow display but do NOT affect brutto.
     *
     * @param {number} year
     * @returns {object} AggregateTotals with backward-compatible fields
     */
    function getAggregatedYearly(year) {
      var jobs = AppState.getState().jobs;
      var totalBrutto = 0;
      var totalNetto = 0;
      var totalTips = 0;
      var totalProvision = 0;
      var totalHours = 0;
      var totalWorkingDays = 0;
      var totalVacationDays = 0;
      var totalSickDays = 0;
      var nettoAvailable = true;
      var perJob = [];

      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        var brutto = calculateYearlyBrutto(job.id, year);
        var nettoResult = calculateYearlyNetto(job.id, year);
        var tips = getTipTotal(job.id, year);
        var provisions = getProvisionTotal(job.id, year);
        var stats = _getJobYearStats(job.id, year);

        totalBrutto += brutto;
        totalTips += tips;
        totalProvision += provisions;
        totalHours += stats.hours;
        totalWorkingDays += stats.workingDays;
        totalVacationDays += stats.vacationDays;
        totalSickDays += stats.sickDays;

        if (nettoResult.available) {
          totalNetto += nettoResult.netto;
        } else {
          nettoAvailable = false;
        }

        perJob.push({
          jobId: job.id,
          employerName: job.employerName,
          type: job.type,
          brutto: brutto,
          netto: nettoResult.available ? nettoResult.netto : null,
          nettoAvailable: nettoResult.available,
          tips: tips,
          provisions: provisions
        });
      }

      // Netto cashflow = total netto + tips
      var nettoCashflow = totalNetto + totalTips;

      return {
        // AggregateTotals shape
        hours: Math.round(totalHours * 100) / 100,
        brutto: Math.round(totalBrutto * 100) / 100,
        netto: Math.round(totalNetto * 100) / 100,
        provision: Math.round(totalProvision * 100) / 100,
        tips: Math.round(totalTips * 100) / 100,
        vacationDays: totalVacationDays,
        sickDays: totalSickDays,
        workingDays: totalWorkingDays,
        // Backward-compatible fields
        totalBrutto: Math.round(totalBrutto * 100) / 100,
        totalNetto: Math.round(totalNetto * 100) / 100,
        totalTips: Math.round(totalTips * 100) / 100,
        nettoCashflow: Math.round(nettoCashflow * 100) / 100,
        nettoAvailable: nettoAvailable,
        perJob: perJob
      };
    }

    /**
     * Initializes the IncomeEngine by subscribing to relevant EventBus events.
     * Subscribes to: workday:saved, workday:deleted, job:updated, profile:updated,
     * earnings:saved, earnings:deleted
     * Emits: income:updated after recalculation
     */
    function init() {
      EventBus.on('workday:saved', _onWorkdayChange);
      EventBus.on('workday:deleted', _onWorkdayChange);
      EventBus.on('job:updated', _onJobUpdated);
      EventBus.on('profile:updated', _onProfileUpdated);
      EventBus.on('earnings:saved', _onEarningsChange);
      EventBus.on('earnings:deleted', _onEarningsChange);
    }

    return {
      init: init,
      calculateMonthlyBrutto: calculateMonthlyBrutto,
      calculateYearlyBrutto: calculateYearlyBrutto,
      calculateMonthlyNetto: calculateMonthlyNetto,
      calculateYearlyNetto: calculateYearlyNetto,
      getAggregatedMonthly: getAggregatedMonthly,
      getAggregatedYearly: getAggregatedYearly,
      getProvisionTotal: getProvisionTotal,
      getTipTotal: getTipTotal,
      getCurrentBillingMonth: _getCurrentBillingMonth,
      getBillingPeriod: _getBillingPeriod
    };
  })();

  // ─── LimitMonitor ─────────────────────────────────────────────────────────────
  // Evaluates legal thresholds and generates warnings for Minijob, 26-week rule, and KFB limits.
  const LimitMonitor = (function () {
    let _initialized = false;

    // ── Regulatory Consequence Messages (German) ──
    const REGULATORY_MESSAGES = {
      minijob_monthly: 'Minijob-Grenze überschritten: Das Beschäftigungsverhältnis wird sozialversicherungspflichtig. Arbeitgeber muss rückwirkend volle Sozialabgaben abführen.',
      kfb_days: 'KFB-Tagesgrenze überschritten: Die kurzfristige Beschäftigung verliert ihren Status. Es fallen rückwirkend Sozialversicherungsbeiträge an.',
      '26_week_rule': '26-Wochen-Regel überschritten: Der Werkstudentenstatus entfällt. Volle Sozialversicherungspflicht tritt rückwirkend ein.'
    };

    // ── Helpers ──

    /**
     * Finds a job by ID from AppState.
     * @param {string} jobId
     * @returns {object|null}
     */
    function _findJob(jobId) {
      var jobs = AppState.getState().jobs;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === jobId) return jobs[i];
      }
      return null;
    }

    /**
     * Returns the ISO week number for a given date string (YYYY-MM-DD).
     * Uses ISO 8601 week numbering.
     * @param {string} dateStr
     * @returns {number}
     */
    function _getISOWeek(dateStr) {
      var d = new Date(dateStr + 'T00:00:00');
      d.setHours(0, 0, 0, 0);
      // Set to nearest Thursday: current date + 4 - current day number (Monday=1, Sunday=7)
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      var yearStart = new Date(d.getFullYear(), 0, 1);
      var weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
      return weekNo;
    }

    /**
     * Returns the number of days in a given month.
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {number}
     */
    function _daysInMonth(year, month) {
      return new Date(year, month, 0).getDate();
    }

    /**
     * Returns the number of days in a given year.
     * @param {number} year
     * @returns {number}
     */
    function _daysInYear(year) {
      return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
    }

    // ── Core Functions ──

    /**
     * Determines the warning level based on a utilization percentage.
     * - safe: 0-79%
     * - warning: 80-94%
     * - critical: 95-99%
     * - exceeded: 100%+
     * @param {number} percentage
     * @returns {string}
     */
    function getWarningLevel(percentage) {
      if (percentage >= 100) return 'exceeded';
      if (percentage >= 95) return 'critical';
      if (percentage >= 80) return 'warning';
      return 'safe';
    }

    /**
     * Applies warning level suppression logic.
     * When a limit reaches critical (95%+) or exceeded (100%+), the yellow warning
     * indicator for that same limit is suppressed — only the highest severity is shown.
     * Since we compute a single percentage per limit, the display level equals the
     * computed warning level (the highest severity always wins per limit).
     * @param {string} warningLevel - The raw warning level
     * @returns {string} The display warning level (with suppression applied)
     */
    function _getDisplayWarningLevel(warningLevel) {
      // Per the spec: only one warning level indicator is shown per limit at any time.
      // The highest severity wins. Since we compute one level per limit check,
      // the display level is the same as the computed level.
      // Suppression means: if critical or exceeded is active, warning (yellow) is NOT shown.
      // This is inherently handled by returning only the single computed level.
      return warningLevel;
    }

    /**
     * Returns true only when WorkDay data exists for the calculation period.
     * Progress bar is only rendered when this returns true.
     * @param {string} limitType - 'minijob_monthly', '26_week_rule', 'kfb_days'
     * @param {string} [jobId] - Required for 'minijob_monthly' and 'kfb_days'
     * @returns {boolean}
     */
    function hasCalculationData(limitType, jobId) {
      var workdays = AppState.getState().workdays;
      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;

      if (limitType === 'minijob_monthly') {
        if (!jobId) return false;
        var prefix = currentYear + '-' + String(currentMonth).padStart(2, '0');
        for (var i = 0; i < workdays.length; i++) {
          if (workdays[i].jobId === jobId && workdays[i].date && workdays[i].date.startsWith(prefix)) {
            return true;
          }
        }
        return false;
      }

      if (limitType === '26_week_rule') {
        // Check if any workday exists for the current year across relevant job types
        var jobs = AppState.getState().jobs;
        var relevantJobIds = [];
        for (var j = 0; j < jobs.length; j++) {
          var jType = jobs[j].type;
          if (jType === 'Werkstudent' || jType === 'Minijob' || jType === 'KFB') {
            relevantJobIds.push(jobs[j].id);
          }
        }
        if (relevantJobIds.length === 0) return false;

        var yearPrefix = String(currentYear) + '-';
        for (var k = 0; k < workdays.length; k++) {
          if (workdays[k].date && workdays[k].date.startsWith(yearPrefix) &&
              relevantJobIds.indexOf(workdays[k].jobId) !== -1) {
            return true;
          }
        }
        return false;
      }

      if (limitType === 'kfb_days') {
        if (!jobId) return false;
        var yearPfx = String(currentYear) + '-';
        for (var m = 0; m < workdays.length; m++) {
          if (workdays[m].jobId === jobId && workdays[m].date && workdays[m].date.startsWith(yearPfx)) {
            return true;
          }
        }
        return false;
      }

      return false;
    }

    /**
     * Checks the Minijob monthly limit for a specific job.
     * Calculates monthly brutto vs 603€ limit.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {object} LimitStatus
     */
    function checkMinijobLimit(jobId, year, month) {
      var job = _findJob(jobId);
      if (!job) {
        return {
          limitType: 'minijob_monthly',
          jobId: jobId,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'Job not found'
        };
      }

      // Get the limit from RuleConfigEngine
      var limit;
      try {
        limit = RuleConfigEngine.getMinijobLimit(year);
      } catch (e) {
        return {
          limitType: 'minijob_monthly',
          jobId: jobId,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'RuleConfig unavailable'
        };
      }

      if (!limit) {
        return {
          limitType: 'minijob_monthly',
          jobId: jobId,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'RuleConfig unavailable'
        };
      }

      // Check if we have calculation data for this period
      var workdays = AppState.getState().workdays;
      var prefix = year + '-' + String(month).padStart(2, '0');
      var hasData = false;
      for (var i = 0; i < workdays.length; i++) {
        if (workdays[i].jobId === jobId && workdays[i].date && workdays[i].date.startsWith(prefix)) {
          hasData = true;
          break;
        }
      }

      if (!hasData) {
        return {
          limitType: 'minijob_monthly',
          jobId: jobId,
          current: 0,
          limit: limit,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: limit,
          status: 'unavailable',
          reason: 'No WorkDay data for this period'
        };
      }

      // Calculate monthly brutto using IncomeEngine
      var current = IncomeEngine.calculateMonthlyBrutto(jobId, year, month);
      var percentage = limit > 0 ? Math.round((current / limit) * 100) : 0;
      var warningLevel = getWarningLevel(percentage);
      var displayWarningLevel = _getDisplayWarningLevel(warningLevel);
      var remaining = Math.max(0, Math.round((limit - current) * 100) / 100);

      return {
        limitType: 'minijob_monthly',
        jobId: jobId,
        current: current,
        limit: limit,
        percentage: percentage,
        warningLevel: warningLevel,
        displayWarningLevel: displayWarningLevel,
        remaining: remaining,
        regulatoryMessage: warningLevel === 'exceeded' ? REGULATORY_MESSAGES['minijob_monthly'] : '',
        suppressed: false,
        status: 'available'
      };
    }

    /**
     * Checks the 26-week rule for a given year.
     * Counts weeks with at least one "worked" WorkDay across Werkstudent + Minijob/KFB jobs combined.
     * @param {number} year
     * @returns {object} LimitStatus
     */
    function check26WeekRule(year) {
      // Get the threshold from RuleConfigEngine
      var threshold;
      try {
        threshold = RuleConfigEngine.get26WeekThreshold(year);
      } catch (e) {
        return {
          limitType: '26_week_rule',
          jobId: null,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'RuleConfig unavailable'
        };
      }

      if (!threshold) {
        return {
          limitType: '26_week_rule',
          jobId: null,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'RuleConfig unavailable'
        };
      }

      // Find all relevant jobs (Werkstudent + Minijob + KFB)
      var jobs = AppState.getState().jobs;
      var relevantJobIds = [];
      for (var j = 0; j < jobs.length; j++) {
        var jType = jobs[j].type;
        if (jType === 'Werkstudent' || jType === 'Minijob' || jType === 'KFB') {
          relevantJobIds.push(jobs[j].id);
        }
      }

      if (relevantJobIds.length === 0) {
        return {
          limitType: '26_week_rule',
          jobId: null,
          current: 0,
          limit: threshold,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: threshold,
          status: 'unavailable',
          reason: 'No relevant jobs configured'
        };
      }

      // Get all workdays for the year across relevant jobs
      var workdays = AppState.getState().workdays;
      var yearPrefix = String(year) + '-';
      var workedWeeks = {};

      for (var i = 0; i < workdays.length; i++) {
        var wd = workdays[i];
        if (!wd.date || !wd.date.startsWith(yearPrefix)) continue;
        if (wd.status !== 'worked') continue;
        if (relevantJobIds.indexOf(wd.jobId) === -1) continue;

        var weekNum = _getISOWeek(wd.date);
        workedWeeks[weekNum] = true;
      }

      var current = Object.keys(workedWeeks).length;

      // Check if we have any data at all for the period
      var hasAnyData = false;
      for (var k = 0; k < workdays.length; k++) {
        if (workdays[k].date && workdays[k].date.startsWith(yearPrefix) &&
            relevantJobIds.indexOf(workdays[k].jobId) !== -1) {
          hasAnyData = true;
          break;
        }
      }

      if (!hasAnyData) {
        return {
          limitType: '26_week_rule',
          jobId: null,
          current: 0,
          limit: threshold,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: threshold,
          status: 'unavailable',
          reason: 'No WorkDay data for this period'
        };
      }

      var percentage = threshold > 0 ? Math.round((current / threshold) * 100) : 0;
      var warningLevel = getWarningLevel(percentage);
      var displayWarningLevel = _getDisplayWarningLevel(warningLevel);
      var remaining = Math.max(0, threshold - current);

      return {
        limitType: '26_week_rule',
        jobId: null,
        current: current,
        limit: threshold,
        percentage: percentage,
        warningLevel: warningLevel,
        displayWarningLevel: displayWarningLevel,
        remaining: remaining,
        regulatoryMessage: warningLevel === 'exceeded' ? REGULATORY_MESSAGES['26_week_rule'] : '',
        suppressed: false,
        status: 'available'
      };
    }

    /**
     * Checks KFB days limit for a specific job in a given year.
     * Counts total working days for KFB job vs kfbMaxDaysPerYear (70).
     * @param {string} jobId
     * @param {number} year
     * @returns {object} LimitStatus
     */
    function checkKFBDays(jobId, year) {
      var job = _findJob(jobId);
      if (!job) {
        return {
          limitType: 'kfb_days',
          jobId: jobId,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'Job not found'
        };
      }

      // Get the limit from RuleConfigEngine
      var limit;
      try {
        limit = RuleConfigEngine.getKFBMaxDays(year);
      } catch (e) {
        return {
          limitType: 'kfb_days',
          jobId: jobId,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'RuleConfig unavailable'
        };
      }

      if (!limit) {
        return {
          limitType: 'kfb_days',
          jobId: jobId,
          current: 0,
          limit: 0,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: 0,
          status: 'unavailable',
          reason: 'RuleConfig unavailable'
        };
      }

      // Count working days for this KFB job in the year
      var workdays = AppState.getState().workdays;
      var yearPrefix = String(year) + '-';
      var workedDays = 0;
      var hasAnyData = false;

      for (var i = 0; i < workdays.length; i++) {
        var wd = workdays[i];
        if (wd.jobId !== jobId || !wd.date || !wd.date.startsWith(yearPrefix)) continue;
        hasAnyData = true;
        if (wd.status === 'worked') {
          workedDays++;
        }
      }

      if (!hasAnyData) {
        return {
          limitType: 'kfb_days',
          jobId: jobId,
          current: 0,
          limit: limit,
          percentage: 0,
          warningLevel: 'safe',
          displayWarningLevel: 'safe',
          remaining: limit,
          status: 'unavailable',
          reason: 'No WorkDay data for this period'
        };
      }

      var percentage = limit > 0 ? Math.round((workedDays / limit) * 100) : 0;
      var warningLevel = getWarningLevel(percentage);
      var displayWarningLevel = _getDisplayWarningLevel(warningLevel);
      var remaining = Math.max(0, limit - workedDays);

      return {
        limitType: 'kfb_days',
        jobId: jobId,
        current: workedDays,
        limit: limit,
        percentage: percentage,
        warningLevel: warningLevel,
        displayWarningLevel: displayWarningLevel,
        remaining: remaining,
        regulatoryMessage: warningLevel === 'exceeded' ? REGULATORY_MESSAGES['kfb_days'] : '',
        suppressed: false,
        status: 'available'
      };
    }

    /**
     * Extrapolates current utilization to end of period.
     * Projection formula: (current / elapsed_days) × total_days
     * @param {string} limitType - 'minijob_monthly', '26_week_rule', 'kfb_days'
     * @param {string} [jobId] - Required for 'minijob_monthly' and 'kfb_days'
     * @returns {object} Projection with projected percentage and whether limit will be exceeded
     */
    function getProjection(limitType, jobId) {
      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;
      var currentDay = now.getDate();

      if (limitType === 'minijob_monthly') {
        var totalDays = _daysInMonth(currentYear, currentMonth);
        var elapsedDays = currentDay;
        var status = checkMinijobLimit(jobId, currentYear, currentMonth);

        if (status.status === 'unavailable' || elapsedDays === 0) {
          return {
            limitType: limitType,
            jobId: jobId,
            projectedCurrent: 0,
            projectedPercentage: 0,
            willExceed: false,
            status: status.status === 'unavailable' ? 'unavailable' : 'available',
            reason: status.reason
          };
        }

        var projectedCurrent = Math.round(((status.current / elapsedDays) * totalDays) * 100) / 100;
        var projectedPercentage = status.limit > 0 ? Math.round((projectedCurrent / status.limit) * 100) : 0;

        return {
          limitType: limitType,
          jobId: jobId,
          projectedCurrent: projectedCurrent,
          projectedPercentage: projectedPercentage,
          willExceed: projectedPercentage >= 100,
          status: 'available'
        };
      }

      if (limitType === '26_week_rule') {
        var totalDaysInYear = _daysInYear(currentYear);
        // Calculate elapsed days in the year
        var startOfYear = new Date(currentYear, 0, 1);
        var elapsedDaysYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
        var status26 = check26WeekRule(currentYear);

        if (status26.status === 'unavailable' || elapsedDaysYear === 0) {
          return {
            limitType: limitType,
            jobId: null,
            projectedCurrent: 0,
            projectedPercentage: 0,
            willExceed: false,
            status: status26.status === 'unavailable' ? 'unavailable' : 'available',
            reason: status26.reason
          };
        }

        var projectedWeeks = Math.round((status26.current / elapsedDaysYear) * totalDaysInYear / 7);
        var projectedPct = status26.limit > 0 ? Math.round((projectedWeeks / status26.limit) * 100) : 0;

        return {
          limitType: limitType,
          jobId: null,
          projectedCurrent: projectedWeeks,
          projectedPercentage: projectedPct,
          willExceed: projectedPct >= 100,
          status: 'available'
        };
      }

      if (limitType === 'kfb_days') {
        var totalDaysKFB = _daysInYear(currentYear);
        var startOfYearKFB = new Date(currentYear, 0, 1);
        var elapsedDaysKFB = Math.floor((now - startOfYearKFB) / (1000 * 60 * 60 * 24)) + 1;
        var statusKFB = checkKFBDays(jobId, currentYear);

        if (statusKFB.status === 'unavailable' || elapsedDaysKFB === 0) {
          return {
            limitType: limitType,
            jobId: jobId,
            projectedCurrent: 0,
            projectedPercentage: 0,
            willExceed: false,
            status: statusKFB.status === 'unavailable' ? 'unavailable' : 'available',
            reason: statusKFB.reason
          };
        }

        var projectedDays = Math.round((statusKFB.current / elapsedDaysKFB) * totalDaysKFB);
        var projectedPctKFB = statusKFB.limit > 0 ? Math.round((projectedDays / statusKFB.limit) * 100) : 0;

        return {
          limitType: limitType,
          jobId: jobId,
          projectedCurrent: projectedDays,
          projectedPercentage: projectedPctKFB,
          willExceed: projectedPctKFB >= 100,
          status: 'available'
        };
      }

      // Unknown limit type
      return {
        limitType: limitType,
        jobId: jobId || null,
        projectedCurrent: 0,
        projectedPercentage: 0,
        willExceed: false,
        status: 'unavailable',
        reason: 'Unknown limit type'
      };
    }

    /**
     * Returns an array of LimitStatus for all active jobs' applicable limits.
     * Applies suppression: when critical/exceeded is active for a limit, suppress
     * warning-level for that same limit type + jobId combination.
     * - Minijob jobs: checkMinijobLimit for current month
     * - KFB jobs: checkKFBDays for current year
     * - If any Werkstudent + Minijob/KFB jobs exist: check26WeekRule for current year
     * @returns {object[]} Array of LimitStatus objects
     */
    function checkAllLimits() {
      var results = [];
      var jobs = AppState.getState().jobs;
      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;

      var hasRelevantFor26Week = false;

      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];

        // Skip jobs that have ended
        if (job.endDate) {
          var endDate = new Date(job.endDate + 'T23:59:59');
          if (endDate < now) continue;
        }

        if (job.type === 'Minijob') {
          results.push(checkMinijobLimit(job.id, currentYear, currentMonth));
          hasRelevantFor26Week = true;
        }

        if (job.type === 'KFB') {
          results.push(checkKFBDays(job.id, currentYear));
          hasRelevantFor26Week = true;
        }

        if (job.type === 'Werkstudent') {
          hasRelevantFor26Week = true;
        }
      }

      // Add 26-week rule check if relevant jobs exist
      if (hasRelevantFor26Week) {
        results.push(check26WeekRule(currentYear));
      }

      // Apply suppression: when critical/exceeded is active, suppress warning-level
      // for the same limitType + jobId combination
      results = _applySuppression(results);

      return results;
    }

    /**
     * Applies suppression logic across all limit results.
     * When a limit is at critical or exceeded level, any warning-level indicator
     * for that same limit (same limitType + jobId) is suppressed.
     * Also attaches regulatory consequence messages for exceeded limits.
     * @param {object[]} results - Array of LimitStatus objects
     * @returns {object[]} Modified array with suppression and messages applied
     */
    function _applySuppression(results) {
      // Build a map of highest severity per limitType+jobId
      var severityMap = {};
      var severityOrder = { safe: 0, warning: 1, critical: 2, exceeded: 3 };

      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var key = r.limitType + '::' + (r.jobId || '');
        var currentSeverity = severityOrder[r.warningLevel] || 0;
        if (!severityMap[key] || currentSeverity > severityMap[key]) {
          severityMap[key] = currentSeverity;
        }
      }

      // Apply suppression and attach regulatory messages
      for (var j = 0; j < results.length; j++) {
        var result = results[j];
        var mapKey = result.limitType + '::' + (result.jobId || '');
        var highestSeverity = severityMap[mapKey] || 0;

        // Suppress warning level when critical or exceeded is active for same limit
        if (result.warningLevel === 'warning' && highestSeverity >= 2) {
          result.displayWarningLevel = 'safe';
          result.suppressed = true;
        } else {
          result.suppressed = false;
        }

        // Attach regulatory consequence message for exceeded limits
        if (result.warningLevel === 'exceeded' || result.displayWarningLevel === 'exceeded') {
          result.regulatoryMessage = REGULATORY_MESSAGES[result.limitType] || '';
        } else {
          result.regulatoryMessage = '';
        }
      }

      return results;
    }

    /**
     * Returns the regulatory consequence message for a given limit type.
     * @param {string} limitType - 'minijob_monthly', '26_week_rule', 'kfb_days'
     * @returns {string} German regulatory message or empty string
     */
    function getRegulatoryMessage(limitType) {
      return REGULATORY_MESSAGES[limitType] || '';
    }

    /**
     * Handles recalculation triggered by events.
     * Rechecks all limits and emits limits:updated event.
     */
    function _onDataChange() {
      if (!_initialized) return;
      var statuses = checkAllLimits();
      EventBus.emit('limits:updated', { statuses: statuses });
    }

    /**
     * Initializes the LimitMonitor module.
     * Subscribes to workday:saved, workday:deleted, job:updated events.
     * Performs initial limit check and emits limits:updated.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Subscribe to relevant events
      EventBus.on('workday:saved', _onDataChange);
      EventBus.on('workday:deleted', _onDataChange);
      EventBus.on('job:updated', _onDataChange);

      // Perform initial check
      _onDataChange();
    }

    return {
      init: init,
      checkMinijobLimit: checkMinijobLimit,
      check26WeekRule: check26WeekRule,
      checkKFBDays: checkKFBDays,
      getWarningLevel: getWarningLevel,
      hasCalculationData: hasCalculationData,
      getProjection: getProjection,
      checkAllLimits: checkAllLimits,
      getRegulatoryMessage: getRegulatoryMessage
    };
  })();

  // ─── TimeTrackerModule ───────────────────────────────────────────────────────
  const TimeTrackerModule = (function () {
    let _initialized = false;

    // ── Helpers ──

    /**
     * Generates a UUID using crypto.randomUUID() with a fallback.
     * @returns {string}
     */
    function _generateUUID() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    /**
     * Returns today's date as YYYY-MM-DD string.
     * @returns {string}
     */
    function _todayStr() {
      var d = new Date();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Finds a job by ID using JobManager.
     * @param {string} jobId
     * @returns {object|null}
     */
    function _findJob(jobId) {
      return JobManager.getJob(jobId);
    }

    // ── Validation ──

    /**
     * Validates a work entry object.
     * @param {object} entry - The entry to validate
     * @returns {{ valid: boolean, errors: string[] }}
     */
    function validateEntry(entry) {
      var errors = [];

      // Date required and format validation (YYYY-MM-DD)
      if (!entry.date) {
        errors.push('Datum ist erforderlich.');
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        errors.push('Datum muss im Format YYYY-MM-DD sein.');
      } else {
        // Validate it's a real date
        var parts = entry.date.split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        var d = parseInt(parts[2], 10);
        var testDate = new Date(y, m - 1, d);
        if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
          errors.push('Datum ist ungültig.');
        }
      }

      // Job required
      if (!entry.jobId) {
        errors.push('Job-Auswahl ist erforderlich.');
      }

      // Status required
      var validStatuses = ['worked', 'vacation', 'sick', 'not_worked'];
      if (!entry.status || validStatuses.indexOf(entry.status) === -1) {
        errors.push('Gültiger Status ist erforderlich.');
      }

      // Hours validation (only for worked status)
      if (entry.status === 'worked') {
        if (entry.hours === null || entry.hours === undefined || entry.hours === '') {
          errors.push('Stunden sind für Arbeitseinträge erforderlich.');
        } else {
          var h = parseFloat(entry.hours);
          if (isNaN(h) || h < 0.25 || h > 24) {
            errors.push('Stunden müssen zwischen 0,25 und 24 liegen.');
          } else if (Math.round(h * 4) !== h * 4) {
            errors.push('Stunden müssen in 0,25-Schritten angegeben werden.');
          }
        }
      }

      // Hourly rate override validation (optional)
      if (entry.hourlyRateOverride !== null && entry.hourlyRateOverride !== undefined && entry.hourlyRateOverride !== '') {
        var rate = parseFloat(entry.hourlyRateOverride);
        if (isNaN(rate) || rate < 0.01 || rate > 999.99) {
          errors.push('Stundenlohn muss zwischen 0,01 und 999,99 liegen.');
        }
      }

      // Note validation (optional, max 500 chars)
      if (entry.note && entry.note.length > 500) {
        errors.push('Notiz darf maximal 500 Zeichen lang sein.');
      }

      return { valid: errors.length === 0, errors: errors };
    }

    // ── Data Access ──

    /**
     * Returns all entries for a given date and optional jobId.
     * @param {string} date - YYYY-MM-DD
     * @param {string} [jobId] - Optional job filter
     * @returns {Array}
     */
    function getEntriesForDate(date, jobId) {
      var workdays = AppState.getState().workdays;
      return workdays.filter(function (w) {
        if (w.date !== date) return false;
        if (jobId && w.jobId !== jobId) return false;
        return true;
      });
    }

    /**
     * Returns all entries for a given year/month and optional jobId.
     * @param {number} year
     * @param {number} month - 1-12
     * @param {string} [jobId] - Optional job filter
     * @returns {Array}
     */
    function getEntriesForMonth(year, month, jobId) {
      var workdays = AppState.getState().workdays;
      var prefix = year + '-' + String(month).padStart(2, '0');
      return workdays.filter(function (w) {
        if (!w.date || !w.date.startsWith(prefix)) return false;
        if (jobId && w.jobId !== jobId) return false;
        return true;
      });
    }

    // ── CRUD Operations ──

    /**
     * Creates a new work entry.
     * Validates, checks max 10 entries per job per day, checks total hours <= 24.
     * @param {object} entry - Entry input
     * @returns {{ success: boolean, error?: string, entry?: object }}
     */
    function createEntry(entry) {
      // Validate
      var validation = validateEntry(entry);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(' ') };
      }

      // Check max 10 entries per job per day
      var existingForDay = getEntriesForDate(entry.date, entry.jobId);
      if (existingForDay.length >= 10) {
        return { success: false, error: 'Maximal 10 Einträge pro Job pro Tag erreicht.' };
      }

      // Check total hours <= 24 for same job+day (only for worked entries)
      if (entry.status === 'worked') {
        var totalHours = 0;
        for (var i = 0; i < existingForDay.length; i++) {
          if (existingForDay[i].status === 'worked' && existingForDay[i].hours) {
            totalHours += parseFloat(existingForDay[i].hours);
          }
        }
        totalHours += parseFloat(entry.hours);
        if (totalHours > 24) {
          return { success: false, error: 'Gesamtstunden für diesen Job an diesem Tag würden 24 überschreiten.' };
        }
      }

      // Build the WorkDay object
      var now = new Date().toISOString();
      var workday = {
        id: _generateUUID(),
        jobId: entry.jobId,
        date: entry.date,
        status: entry.status,
        hours: entry.status === 'worked' ? parseFloat(entry.hours) : null,
        hourlyRateOverride: (entry.hourlyRateOverride !== null && entry.hourlyRateOverride !== undefined && entry.hourlyRateOverride !== '') ? parseFloat(entry.hourlyRateOverride) : null,
        note: entry.note || null,
        paidSickLeave: entry.paidSickLeave || false,
        createdAt: now,
        updatedAt: now
      };

      // Persist
      var workdays = AppState.getState().workdays.slice();
      workdays.push(workday);
      var result = AppState.setState('workdays', workdays);
      if (!result.success) {
        return { success: false, error: 'Failed to save entry.' };
      }

      // Emit event
      EventBus.emit('workday:saved', { entry: workday });

      return { success: true, entry: workday };
    }

    /**
     * Updates an existing work entry by ID.
     * @param {string} id - Entry ID
     * @param {object} updates - Partial entry updates
     * @returns {{ success: boolean, error?: string }}
     */
    function updateEntry(id, updates) {
      var workdays = AppState.getState().workdays.slice();
      var index = -1;
      for (var i = 0; i < workdays.length; i++) {
        if (workdays[i].id === id) {
          index = i;
          break;
        }
      }
      if (index === -1) {
        return { success: false, error: 'Entry not found.' };
      }

      // Merge updates
      var existing = Object.assign({}, workdays[index]);
      var merged = Object.assign({}, existing, updates);
      merged.id = existing.id;
      merged.createdAt = existing.createdAt;
      merged.updatedAt = new Date().toISOString();

      // Validate merged entry
      var validation = validateEntry(merged);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(' ') };
      }

      // Check total hours <= 24 (excluding this entry)
      if (merged.status === 'worked') {
        var entriesForDay = getEntriesForDate(merged.date, merged.jobId);
        var totalHours = 0;
        for (var j = 0; j < entriesForDay.length; j++) {
          if (entriesForDay[j].id !== id && entriesForDay[j].status === 'worked' && entriesForDay[j].hours) {
            totalHours += parseFloat(entriesForDay[j].hours);
          }
        }
        totalHours += parseFloat(merged.hours);
        if (totalHours > 24) {
          return { success: false, error: 'Gesamtstunden für diesen Job an diesem Tag würden 24 überschreiten.' };
        }
      }

      // Persist
      workdays[index] = merged;
      var result = AppState.setState('workdays', workdays);
      if (!result.success) {
        return { success: false, error: 'Failed to update entry.' };
      }

      EventBus.emit('workday:saved', { entry: merged });
      return { success: true };
    }

    /**
     * Deletes a work entry by ID.
     * @param {string} id - Entry ID
     * @returns {{ success: boolean, error?: string }}
     */
    function deleteEntry(id) {
      var workdays = AppState.getState().workdays.slice();
      var found = false;
      var deletedEntry = null;
      workdays = workdays.filter(function (w) {
        if (w.id === id) {
          found = true;
          deletedEntry = w;
          return false;
        }
        return true;
      });

      if (!found) {
        return { success: false, error: 'Entry not found.' };
      }

      var result = AppState.setState('workdays', workdays);
      if (!result.success) {
        return { success: false, error: 'Failed to delete entry.' };
      }

      EventBus.emit('workday:deleted', { id: deletedEntry.id, jobId: deletedEntry.jobId });
      return { success: true };
    }

    /**
     * Quick-confirm a day: creates an entry with the job's standardHoursPerDay, status "worked".
     * @param {string} jobId
     * @param {string} date - YYYY-MM-DD
     * @returns {{ success: boolean, error?: string }}
     */
    function quickConfirmDay(jobId, date) {
      var job = _findJob(jobId);
      if (!job) {
        return { success: false, error: 'Job not found.' };
      }

      var hours = job.standardHoursPerDay;
      if (!hours || hours <= 0) {
        return { success: false, error: 'Job does not have standardHoursPerDay configured.' };
      }

      return createEntry({
        jobId: jobId,
        date: date,
        status: 'worked',
        hours: hours,
        hourlyRateOverride: null,
        note: null,
        paidSickLeave: false
      });
    }

    // ── UI Rendering ──

    /**
     * Shows or hides the "no jobs" prompt in the daily view.
     * When onboarding is complete but no jobs exist, shows a prompt to add the first job.
     */
    function _updateNoJobsPrompt() {
      var promptEl = document.getElementById('daily-no-jobs-prompt');
      var formCard = document.querySelector('.daily-form-card');
      var jobs = AppState.getState().jobs;

      if (jobs.length === 0 && AppState.isOnboardingComplete()) {
        // Show the no-jobs prompt
        if (!promptEl) {
          // Create the prompt element
          promptEl = document.createElement('div');
          promptEl.id = 'daily-no-jobs-prompt';
          promptEl.className = 'glass-surface layer-content daily-no-jobs-card';
          promptEl.innerHTML =
            '<div class="daily-no-jobs-content">' +
            '<span class="daily-no-jobs-icon">💼</span>' +
            '<h3 class="daily-no-jobs-heading">Keine Jobs konfiguriert</h3>' +
            '<p class="daily-no-jobs-text">Füge deinen ersten Job in den Einstellungen hinzu, um deine Arbeitszeiten und Einkommen zu erfassen.</p>' +
            '<button type="button" id="daily-add-job-btn" class="btn btn-primary">Zu den Einstellungen</button>' +
            '</div>';
          // Insert before the form card
          if (formCard && formCard.parentNode) {
            formCard.parentNode.insertBefore(promptEl, formCard);
          }
          // Bind the button
          var addBtn = document.getElementById('daily-add-job-btn');
          if (addBtn) {
            addBtn.addEventListener('click', function () {
              NavigationController.switchTo('view-settings');
            });
          }
        }
        promptEl.style.display = '';
        // Hide the form card when no jobs
        if (formCard) formCard.style.display = 'none';
      } else {
        // Hide the prompt, show the form
        if (promptEl) promptEl.style.display = 'none';
        if (formCard) formCard.style.display = '';
      }
    }

    /**
     * Populates the job selector dropdown with current jobs.
     */
    function _populateJobSelector() {
      var select = document.getElementById('daily-job-select');
      if (!select) return;

      var jobs = AppState.getState().jobs;
      // Keep the first placeholder option
      select.innerHTML = '<option value="">— Job auswählen —</option>';
      for (var i = 0; i < jobs.length; i++) {
        var opt = document.createElement('option');
        opt.value = jobs[i].id;
        opt.textContent = jobs[i].employerName + ' (' + jobs[i].type + ')';
        select.appendChild(opt);
      }

      // Update no-jobs prompt visibility
      _updateNoJobsPrompt();
    }

    /**
     * Shows/hides provision, tip, quick-confirm fields based on selected job config.
     */
    function _updateFieldVisibility() {
      var select = document.getElementById('daily-job-select');
      var jobId = select ? select.value : '';
      var job = jobId ? _findJob(jobId) : null;

      // Quick confirm group
      var quickGroup = document.getElementById('daily-quick-confirm-group');
      var quickHoursSpan = document.getElementById('daily-quick-hours');
      if (quickGroup) {
        if (job && job.standardHoursPerDay && (job.type === 'Vollzeit' || job.type === 'Teilzeit')) {
          quickGroup.style.display = '';
          if (quickHoursSpan) quickHoursSpan.textContent = job.standardHoursPerDay;
        } else {
          quickGroup.style.display = 'none';
        }
      }

      // Provision group
      var provGroup = document.getElementById('daily-provision-group');
      if (provGroup) {
        provGroup.style.display = (job && job.hasProvision) ? '' : 'none';
      }

      // Tip group
      var tipGroup = document.getElementById('daily-tip-group');
      if (tipGroup) {
        tipGroup.style.display = (job && job.hasTipTracking) ? '' : 'none';
      }
    }

    /**
     * Updates hours/note field visibility based on status selection.
     * Shows vacation remaining indicator and highlights note field for vacation/sick.
     */
    function _updateStatusFields() {
      var statusSelect = document.getElementById('daily-status');
      var hoursGroup = document.getElementById('daily-hours-group');
      var rateGroup = document.getElementById('daily-rate-override-group');
      var noteGroup = document.getElementById('daily-note-group');
      var vacRemainingGroup = document.getElementById('daily-vacation-remaining-group');
      var status = statusSelect ? statusSelect.value : 'worked';

      if (hoursGroup) {
        hoursGroup.style.display = (status === 'worked') ? '' : 'none';
      }
      if (rateGroup) {
        rateGroup.style.display = (status === 'worked') ? '' : 'none';
      }

      // Highlight note field for vacation/sick entries
      if (noteGroup) {
        if (status === 'vacation' || status === 'sick') {
          noteGroup.classList.add('note-highlighted');
          // Update label to indicate note is recommended
          var noteLabel = noteGroup.querySelector('.form-label');
          if (noteLabel) {
            noteLabel.textContent = 'Notiz (empfohlen für ' + (status === 'vacation' ? 'Urlaub' : 'Krank') + ')';
          }
        } else {
          noteGroup.classList.remove('note-highlighted');
          var noteLabel2 = noteGroup.querySelector('.form-label');
          if (noteLabel2) {
            noteLabel2.textContent = 'Notiz (optional)';
          }
        }
      }

      // Show vacation remaining indicator
      _updateVacationRemainingIndicator();
    }

    /**
     * Updates the vacation remaining indicator based on selected job and status.
     */
    function _updateVacationRemainingIndicator() {
      var vacGroup = document.getElementById('daily-vacation-remaining-group');
      var vacText = document.getElementById('daily-vacation-remaining-text');
      var statusSelect = document.getElementById('daily-status');
      var jobSelect = document.getElementById('daily-job-select');
      var dateInput = document.getElementById('daily-date');

      if (!vacGroup) return;

      var status = statusSelect ? statusSelect.value : 'worked';
      var jobId = jobSelect ? jobSelect.value : '';

      // Only show for vacation/sick status with a selected job
      if ((status !== 'vacation' && status !== 'sick') || !jobId) {
        vacGroup.style.display = 'none';
        return;
      }

      var job = _findJob(jobId);
      if (!job || job.vacationEntitlement === null || job.vacationEntitlement === undefined || job.vacationEntitlement === 0) {
        // No vacation entitlement configured — hide indicator
        vacGroup.style.display = 'none';
        return;
      }

      // Calculate remaining vacation days for the year
      var date = dateInput ? dateInput.value : _todayStr();
      var year = parseInt(date.substring(0, 4), 10) || new Date().getFullYear();
      var allWorkdays = AppState.getState().workdays;
      var vacDaysTaken = 0;
      var yearPrefix = String(year);
      for (var k = 0; k < allWorkdays.length; k++) {
        if (allWorkdays[k].jobId === jobId &&
            allWorkdays[k].status === 'vacation' &&
            allWorkdays[k].date && allWorkdays[k].date.startsWith(yearPrefix)) {
          vacDaysTaken++;
        }
      }

      var remaining = Math.max(0, job.vacationEntitlement - vacDaysTaken);
      vacGroup.style.display = '';

      if (vacText) {
        if (status === 'vacation') {
          vacText.textContent = remaining + ' Urlaubstag' + (remaining !== 1 ? 'e' : '') + ' verbleibend (von ' + job.vacationEntitlement + ')';
          // Add warning class if exhausted
          var indicator = document.getElementById('daily-vacation-remaining');
          if (indicator) {
            if (remaining === 0) {
              indicator.classList.add('vacation-exhausted');
            } else {
              indicator.classList.remove('vacation-exhausted');
            }
          }
        } else {
          // Sick status — show vacation info for context
          vacText.textContent = remaining + ' Urlaubstag' + (remaining !== 1 ? 'e' : '') + ' verbleibend (von ' + job.vacationEntitlement + ')';
          var indicator2 = document.getElementById('daily-vacation-remaining');
          if (indicator2) {
            indicator2.classList.remove('vacation-exhausted');
          }
        }
      }
    }

    /**
     * Renders entries for the selected date in the day summary section.
     */
    function _renderDaySummary() {
      var dateInput = document.getElementById('daily-date');
      var date = dateInput ? dateInput.value : _todayStr();
      var container = document.getElementById('daily-summary-entries');
      var dateLabel = document.getElementById('daily-summary-date-label');

      if (!container) return;

      if (dateLabel) {
        if (date === _todayStr()) {
          dateLabel.textContent = 'Heute';
        } else {
          dateLabel.textContent = date;
        }
      }

      var entries = getEntriesForDate(date);

      if (!entries || entries.length === 0) {
        container.innerHTML = '<p class="daily-empty-state" id="daily-no-entries">Keine Einträge für dieses Datum.</p>';
        return;
      }

      var html = '';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var job = _findJob(e.jobId);
        var jobName = job ? job.employerName : 'Unknown';
        var hoursStr = e.hours !== null ? e.hours + 'h' : '\u2014';
        var statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);

        html += '<div class="daily-entry-item" data-entry-id="' + e.id + '">';
        html += '<div class="daily-entry-header">';
        html += '<span class="daily-entry-job">' + _escapeHtml(jobName) + '</span>';
        html += '<span class="daily-entry-status status-' + e.status + '">' + statusLabel + '</span>';
        html += '</div>';
        html += '<div class="daily-entry-details">';
        html += '<span class="daily-entry-hours">' + hoursStr + '</span>';
        if (e.note) {
          html += '<span class="daily-entry-note">' + _escapeHtml(e.note) + '</span>';
        }
        html += '</div>';
        html += '<button type="button" class="daily-entry-delete-btn" data-entry-id="' + e.id + '" aria-label="Delete entry">\u2715</button>';
        html += '</div>';
      }
      container.innerHTML = html;

      // Bind delete buttons
      var deleteBtns = container.querySelectorAll('.daily-entry-delete-btn');
      for (var d = 0; d < deleteBtns.length; d++) {
        deleteBtns[d].addEventListener('click', function () {
          var entryId = this.getAttribute('data-entry-id');
          deleteEntry(entryId);
          _renderDaySummary();
        });
      }
    }

    /**
     * Clears form error messages.
     */
    function _clearFormErrors() {
      var errorIds = ['daily-date-error', 'daily-job-error', 'daily-status-error',
        'daily-hours-error', 'daily-rate-override-error', 'daily-provision-error',
        'daily-tip-error'];
      for (var i = 0; i < errorIds.length; i++) {
        var el = document.getElementById(errorIds[i]);
        if (el) el.textContent = '';
      }
    }

    /**
     * Displays validation errors on the form.
     * @param {string[]} errors
     */
    function _displayFormErrors(errors) {
      for (var i = 0; i < errors.length; i++) {
        var msg = errors[i];
        if (msg.indexOf('Datum') !== -1 || msg.indexOf('Date') !== -1) {
          _setFieldError('daily-date-error', msg);
        } else if (msg.indexOf('Job') !== -1) {
          _setFieldError('daily-job-error', msg);
        } else if (msg.indexOf('Stunden') !== -1 || msg.indexOf('Hours') !== -1 || msg.indexOf('hours') !== -1) {
          _setFieldError('daily-hours-error', msg);
        } else if (msg.indexOf('Stundenlohn') !== -1 || msg.indexOf('rate') !== -1) {
          _setFieldError('daily-rate-override-error', msg);
        } else if (msg.indexOf('Status') !== -1 || msg.indexOf('status') !== -1) {
          _setFieldError('daily-status-error', msg);
        } else {
          _setFieldError('daily-hours-error', msg);
        }
      }
    }

    /**
     * Sets a field error message.
     * @param {string} id
     * @param {string} msg
     */
    function _setFieldError(id, msg) {
      var el = document.getElementById(id);
      if (el) el.textContent = msg;
    }

    /**
     * Handles form submission for daily entry.
     * @param {Event} e
     */
    function _onFormSubmit(e) {
      e.preventDefault();
      _clearFormErrors();

      var dateInput = document.getElementById('daily-date');
      var jobSelect = document.getElementById('daily-job-select');
      var statusSelect = document.getElementById('daily-status');
      var hoursInput = document.getElementById('daily-hours');
      var rateInput = document.getElementById('daily-rate-override');
      var noteInput = document.getElementById('daily-note');

      var date = dateInput ? dateInput.value : '';
      var jobId = jobSelect ? jobSelect.value : '';
      var status = statusSelect ? statusSelect.value : '';
      var hours = hoursInput ? hoursInput.value : '';
      var rateOverride = rateInput ? rateInput.value : '';
      var note = noteInput ? noteInput.value : '';

      var entry = {
        date: date,
        jobId: jobId,
        status: status,
        hours: status === 'worked' ? hours : null,
        hourlyRateOverride: rateOverride || null,
        note: note || null,
        paidSickLeave: false
      };

      // Vacation/sick day logic: check for existing work entries
      if ((status === 'vacation' || status === 'sick') && jobId && date) {
        var existingEntries = getEntriesForDate(date, jobId);
        var hasWorkEntry = false;
        for (var i = 0; i < existingEntries.length; i++) {
          if (existingEntries[i].status === 'worked') {
            hasWorkEntry = true;
            break;
          }
        }
        if (hasWorkEntry) {
          if (!confirm('A work entry already exists for this job on this date. Replace with ' + status + '?')) {
            return;
          }
          // Delete existing work entries for this job+date
          for (var j = existingEntries.length - 1; j >= 0; j--) {
            if (existingEntries[j].status === 'worked') {
              deleteEntry(existingEntries[j].id);
            }
          }
        }
      }

      // Vacation entitlement check
      if (status === 'vacation' && jobId) {
        var job = _findJob(jobId);
        if (job && job.vacationEntitlement !== null && job.vacationEntitlement !== undefined) {
          var year = parseInt(date.substring(0, 4), 10);
          var allWorkdays = AppState.getState().workdays;
          var vacDaysTaken = 0;
          var yearPrefix = String(year);
          for (var k = 0; k < allWorkdays.length; k++) {
            if (allWorkdays[k].jobId === jobId &&
                allWorkdays[k].status === 'vacation' &&
                allWorkdays[k].date && allWorkdays[k].date.startsWith(yearPrefix)) {
              vacDaysTaken++;
            }
          }
          if (vacDaysTaken >= job.vacationEntitlement) {
            if (!confirm('Vacation entitlement is exhausted (0 remaining). Save anyway?')) {
              return;
            }
          }
        }
      }

      var result = createEntry(entry);
      if (!result.success) {
        _displayFormErrors([result.error]);
        return;
      }

      // Reset form (keep date and job selected)
      if (hoursInput) hoursInput.value = '';
      if (rateInput) rateInput.value = '';
      if (noteInput) noteInput.value = '';
      var noteCount = document.getElementById('daily-note-count');
      if (noteCount) noteCount.textContent = '0 / 500';

      // Refresh day summary and vacation indicator
      _renderDaySummary();
      _updateVacationRemainingIndicator();
    }

    /**
     * Handles quick confirm button click.
     */
    function _onQuickConfirm() {
      var dateInput = document.getElementById('daily-date');
      var jobSelect = document.getElementById('daily-job-select');
      var date = dateInput ? dateInput.value : _todayStr();
      var jobId = jobSelect ? jobSelect.value : '';

      if (!jobId) {
        _setFieldError('daily-job-error', 'Bitte zuerst einen Job auswählen.');
        return;
      }
      if (!date) {
        _setFieldError('daily-date-error', 'Bitte zuerst ein Datum auswählen.');
        return;
      }

      _clearFormErrors();
      var result = quickConfirmDay(jobId, date);
      if (!result.success) {
        _displayFormErrors([result.error]);
        return;
      }

      _renderDaySummary();
    }

    /**
     * Handles note character counter.
     */
    function _onNoteInput() {
      var noteInput = document.getElementById('daily-note');
      var noteCount = document.getElementById('daily-note-count');
      if (noteInput && noteCount) {
        noteCount.textContent = noteInput.value.length + ' / 500';
      }
    }

    // ── Initialization ──

    /**
     * Initializes the TimeTrackerModule — binds event handlers and sets up the view.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Set date picker to today
      var dateInput = document.getElementById('daily-date');
      if (dateInput) {
        dateInput.value = _todayStr();
      }

      // Populate job selector
      _populateJobSelector();

      // Bind job selector change
      var jobSelect = document.getElementById('daily-job-select');
      if (jobSelect) {
        jobSelect.addEventListener('change', function () {
          _updateFieldVisibility();
          _updateVacationRemainingIndicator();
        });
      }

      // Bind status selector change
      var statusSelect = document.getElementById('daily-status');
      if (statusSelect) {
        statusSelect.addEventListener('change', function () {
          _updateStatusFields();
        });
      }

      // Bind date picker change to refresh day summary and vacation indicator
      if (dateInput) {
        dateInput.addEventListener('change', function () {
          _renderDaySummary();
          _updateVacationRemainingIndicator();
        });
      }

      // Bind form submission
      var form = document.getElementById('daily-entry-form');
      if (form) {
        form.addEventListener('submit', _onFormSubmit);
      }

      // Bind quick confirm button
      var quickBtn = document.getElementById('daily-quick-confirm-btn');
      if (quickBtn) {
        quickBtn.addEventListener('click', _onQuickConfirm);
      }

      // Bind note character counter
      var noteInput = document.getElementById('daily-note');
      if (noteInput) {
        noteInput.addEventListener('input', _onNoteInput);
      }

      // Initial field visibility
      _updateFieldVisibility();
      _updateStatusFields();

      // Render day summary for today
      _renderDaySummary();

      // Listen for job changes to refresh the selector
      EventBus.on('job:created', function () {
        _populateJobSelector();
        _updateFieldVisibility();
      });
      EventBus.on('job:updated', function () {
        _populateJobSelector();
        _updateFieldVisibility();
      });
      EventBus.on('job:deleted', function () {
        _populateJobSelector();
        _updateFieldVisibility();
        _renderDaySummary();
      });
      EventBus.on('data:imported', function () {
        _populateJobSelector();
        _updateFieldVisibility();
        _renderDaySummary();
      });
    }

    // ── Inline Entry Row Rendering ──
    // Renders a compact inline entry form within a job card container.
    // Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 9.1, 9.2, 9.4, 9.7

    /**
     * Renders an inline entry row for a specific job within a container element.
     * The row includes: date (default today), status selector, hours (0.25–24, step 0.25),
     * provision (if hasProvision), tip (if hasTipTracking), notes (for vacation/sick),
     * quick-confirm button (for Teilzeit/Vollzeit with standardHoursPerDay), and submit button.
     *
     * @param {string} jobId - The job ID to render the entry row for
     * @param {HTMLElement} container - The DOM element to render into
     */
    function renderInlineEntryRow(jobId, container) {
      if (!container) return;

      var job = _findJob(jobId);
      if (!job) return;

      var uid = 'ier-' + jobId.substring(0, 8);

      // Build the inline entry row HTML
      var html = '<form class="inline-entry-row" id="' + uid + '-form" autocomplete="off">';

      // Date input (default today)
      html += '<div class="form-group">';
      html += '<label class="form-label" for="' + uid + '-date">Datum</label>';
      html += '<input type="date" class="form-input" id="' + uid + '-date" value="' + _todayStr() + '" required>';
      html += '<span class="field-error" id="' + uid + '-date-error"></span>';
      html += '</div>';

      // Status selector (worked/vacation/sick/not_worked)
      html += '<div class="form-group">';
      html += '<label class="form-label" for="' + uid + '-status">Status</label>';
      html += '<select class="form-select" id="' + uid + '-status">';
      html += '<option value="worked">Gearbeitet</option>';
      html += '<option value="vacation">Urlaub</option>';
      html += '<option value="sick">Krank</option>';
      html += '<option value="not_worked">Nicht gearbeitet</option>';
      html += '</select>';
      html += '<span class="field-error" id="' + uid + '-status-error"></span>';
      html += '</div>';

      // Hours input (0.25–24, step 0.25)
      html += '<div class="form-group" id="' + uid + '-hours-group">';
      html += '<label class="form-label" for="' + uid + '-hours">Stunden</label>';
      html += '<input type="number" class="form-input" id="' + uid + '-hours" min="0.25" max="24" step="0.25" placeholder="0.25–24">';
      html += '<span class="field-error" id="' + uid + '-hours-error"></span>';
      html += '</div>';

      // Provision input (only if job has hasProvision)
      if (job.hasProvision) {
        html += '<div class="form-group" id="' + uid + '-provision-group">';
        html += '<label class="form-label" for="' + uid + '-provision">Provision (€)</label>';
        html += '<input type="number" class="form-input" id="' + uid + '-provision" min="0.01" max="99999.99" step="0.01" placeholder="0,00">';
        html += '<span class="field-error" id="' + uid + '-provision-error"></span>';
        html += '</div>';
      }

      // Tip input (only if job has hasTipTracking)
      if (job.hasTipTracking) {
        html += '<div class="form-group" id="' + uid + '-tip-group">';
        html += '<label class="form-label" for="' + uid + '-tip">Trinkgeld (€)</label>';
        html += '<input type="number" class="form-input" id="' + uid + '-tip" min="0.01" max="99999.99" step="0.01" placeholder="0,00">';
        html += '<span class="field-error" id="' + uid + '-tip-error"></span>';
        html += '</div>';
      }

      // Note field (shown for vacation/sick, max 500 chars)
      html += '<div class="form-group" id="' + uid + '-note-group" style="display:none;">';
      html += '<label class="form-label" for="' + uid + '-note">Notiz (optional)</label>';
      html += '<input type="text" class="form-input" id="' + uid + '-note" maxlength="500" placeholder="Max. 500 Zeichen">';
      html += '<span class="inline-entry-note-counter" id="' + uid + '-note-count">0 / 500</span>';
      html += '<span class="field-error" id="' + uid + '-note-error"></span>';
      html += '</div>';

      // Vacation remaining indicator
      html += '<div class="form-group inline-entry-vacation-info" id="' + uid + '-vac-info" style="display:none;">';
      html += '<span class="vacation-remaining-text" id="' + uid + '-vac-text"></span>';
      html += '</div>';

      // Submit button
      html += '<div class="form-group inline-entry-actions">';
      html += '<button type="submit" class="btn btn-primary inline-entry-submit" id="' + uid + '-submit">Speichern</button>';

      // Quick-confirm button for Teilzeit/Vollzeit with standardHoursPerDay
      if ((job.type === 'Teilzeit' || job.type === 'Vollzeit') && job.standardHoursPerDay) {
        html += '<button type="button" class="btn btn-secondary quick-confirm-btn" id="' + uid + '-quick" title="' + job.standardHoursPerDay + 'h Standardtag eintragen">';
        html += '⚡ ' + job.standardHoursPerDay + 'h';
        html += '</button>';
      }

      html += '</div>';
      html += '</form>';

      container.innerHTML = html;

      // ── Bind event handlers ──

      var form = document.getElementById(uid + '-form');
      var dateInput = document.getElementById(uid + '-date');
      var statusSelect = document.getElementById(uid + '-status');
      var hoursInput = document.getElementById(uid + '-hours');
      var noteInput = document.getElementById(uid + '-note');
      var noteCount = document.getElementById(uid + '-note-count');
      var hoursGroup = document.getElementById(uid + '-hours-group');
      var noteGroup = document.getElementById(uid + '-note-group');
      var vacInfo = document.getElementById(uid + '-vac-info');
      var quickBtn = document.getElementById(uid + '-quick');

      // Status change: show/hide hours and note fields
      function updateStatusVisibility() {
        var status = statusSelect ? statusSelect.value : 'worked';
        if (hoursGroup) {
          hoursGroup.style.display = (status === 'worked') ? '' : 'none';
        }
        if (noteGroup) {
          noteGroup.style.display = (status === 'vacation' || status === 'sick') ? '' : 'none';
        }
        // Show provision/tip only for worked status
        var provGroup = document.getElementById(uid + '-provision-group');
        var tipGroup = document.getElementById(uid + '-tip-group');
        if (provGroup) provGroup.style.display = (status === 'worked') ? '' : 'none';
        if (tipGroup) tipGroup.style.display = (status === 'worked') ? '' : 'none';

        // Update vacation remaining indicator
        updateVacationIndicator();
      }

      // Vacation remaining indicator
      function updateVacationIndicator() {
        if (!vacInfo) return;
        var status = statusSelect ? statusSelect.value : 'worked';
        if (status !== 'vacation' || !job.vacationEntitlement) {
          vacInfo.style.display = 'none';
          return;
        }

        var date = dateInput ? dateInput.value : _todayStr();
        var year = parseInt(date.substring(0, 4), 10) || new Date().getFullYear();
        var allWorkdays = AppState.getState().workdays;
        var vacDaysTaken = 0;
        var yearPrefix = String(year);
        for (var k = 0; k < allWorkdays.length; k++) {
          if (allWorkdays[k].jobId === jobId &&
              allWorkdays[k].status === 'vacation' &&
              allWorkdays[k].date && allWorkdays[k].date.startsWith(yearPrefix)) {
            vacDaysTaken++;
          }
        }
        var remaining = Math.max(0, job.vacationEntitlement - vacDaysTaken);
        var vacText = document.getElementById(uid + '-vac-text');
        if (vacText) {
          vacText.textContent = remaining + ' Urlaubstag' + (remaining !== 1 ? 'e' : '') + ' verbleibend (von ' + job.vacationEntitlement + ')';
          if (remaining === 0) {
            vacText.classList.add('vacation-exhausted');
          } else {
            vacText.classList.remove('vacation-exhausted');
          }
        }
        vacInfo.style.display = '';
      }

      // Clear all inline errors for this row
      function clearErrors() {
        var errorEls = container.querySelectorAll('.field-error');
        for (var i = 0; i < errorEls.length; i++) {
          errorEls[i].textContent = '';
        }
        var inputEls = container.querySelectorAll('.input-error');
        for (var j = 0; j < inputEls.length; j++) {
          inputEls[j].classList.remove('input-error');
        }
      }

      // Set error on a specific field
      function setFieldError(fieldId, msg) {
        var errorEl = document.getElementById(fieldId);
        if (errorEl) errorEl.textContent = msg;
        // Also mark the input
        var inputEl = document.getElementById(fieldId.replace('-error', ''));
        if (inputEl) inputEl.classList.add('input-error');
      }

      // Form submission handler
      function onSubmit(e) {
        e.preventDefault();
        clearErrors();

        var date = dateInput ? dateInput.value : '';
        var status = statusSelect ? statusSelect.value : 'worked';
        var hours = hoursInput ? hoursInput.value : '';
        var note = noteInput ? noteInput.value : '';

        // Build entry
        var entry = {
          date: date,
          jobId: jobId,
          status: status,
          hours: status === 'worked' ? hours : null,
          hourlyRateOverride: null,
          note: (status === 'vacation' || status === 'sick') ? (note || null) : null,
          paidSickLeave: (status === 'sick')
        };

        // Validate
        var validation = validateEntry(entry);
        if (!validation.valid) {
          // Display inline errors
          for (var i = 0; i < validation.errors.length; i++) {
            var msg = validation.errors[i];
            if (msg.indexOf('Datum') !== -1) {
              setFieldError(uid + '-date-error', msg);
            } else if (msg.indexOf('Stunden') !== -1) {
              setFieldError(uid + '-hours-error', msg);
            } else if (msg.indexOf('Status') !== -1) {
              setFieldError(uid + '-status-error', msg);
            } else if (msg.indexOf('Notiz') !== -1) {
              setFieldError(uid + '-note-error', msg);
            } else {
              setFieldError(uid + '-hours-error', msg);
            }
          }
          return;
        }

        // Check for existing entry replacement (Req 9.2)
        if (date && (status === 'vacation' || status === 'sick')) {
          var existingEntries = getEntriesForDate(date, jobId);
          var hasWorkEntry = false;
          for (var x = 0; x < existingEntries.length; x++) {
            if (existingEntries[x].status === 'worked') {
              hasWorkEntry = true;
              break;
            }
          }
          if (hasWorkEntry) {
            var statusLabel = status === 'vacation' ? 'Urlaub' : 'Krank';
            if (!confirm('Ein Arbeitseintrag existiert bereits für diesen Tag. Mit ' + statusLabel + ' ersetzen?')) {
              return;
            }
            // Delete existing work entries for this job+date
            for (var y = existingEntries.length - 1; y >= 0; y--) {
              if (existingEntries[y].status === 'worked') {
                deleteEntry(existingEntries[y].id);
              }
            }
          }
        }

        // Vacation entitlement exhausted check (Req 9.4)
        if (status === 'vacation' && job.vacationEntitlement !== null && job.vacationEntitlement !== undefined) {
          var entryYear = parseInt(date.substring(0, 4), 10);
          var allWd = AppState.getState().workdays;
          var vacTaken = 0;
          var yrPrefix = String(entryYear);
          for (var z = 0; z < allWd.length; z++) {
            if (allWd[z].jobId === jobId &&
                allWd[z].status === 'vacation' &&
                allWd[z].date && allWd[z].date.startsWith(yrPrefix)) {
              vacTaken++;
            }
          }
          if (vacTaken >= job.vacationEntitlement) {
            if (!confirm('Urlaubsanspruch erschöpft (0 verbleibend). Trotzdem speichern?')) {
              return;
            }
          }
        }

        // Also check for any existing entry on same date+job (general replacement prompt)
        var existingAll = getEntriesForDate(date, jobId);
        if (existingAll.length > 0 && status === 'worked') {
          var hasNonWorked = false;
          for (var w = 0; w < existingAll.length; w++) {
            if (existingAll[w].status !== 'worked') {
              hasNonWorked = true;
              break;
            }
          }
          if (hasNonWorked) {
            if (!confirm('Ein Eintrag existiert bereits für diesen Tag. Trotzdem hinzufügen?')) {
              return;
            }
          }
        }

        // Create the entry
        var result = createEntry(entry);
        if (!result.success) {
          setFieldError(uid + '-hours-error', result.error);
          return;
        }

        // Handle provision/tip as EarningsExtra entries
        if (status === 'worked') {
          var provInput = document.getElementById(uid + '-provision');
          var tipInput = document.getElementById(uid + '-tip');
          var provVal = provInput ? parseFloat(provInput.value) : NaN;
          var tipVal = tipInput ? parseFloat(tipInput.value) : NaN;

          if (!isNaN(provVal) && provVal > 0 && job.hasProvision) {
            EarningsExtraModule.addEarning({
              jobId: jobId,
              workdayId: result.entry.id,
              type: 'provision',
              amount: provVal,
              date: date,
              note: null
            });
          }
          if (!isNaN(tipVal) && tipVal > 0 && job.hasTipTracking) {
            EarningsExtraModule.addEarning({
              jobId: jobId,
              workdayId: result.entry.id,
              type: 'tip',
              amount: tipVal,
              date: date,
              note: null
            });
          }
        }

        // Clear inputs after successful submission (Req 4.4)
        if (hoursInput) hoursInput.value = '';
        if (noteInput) { noteInput.value = ''; }
        if (noteCount) noteCount.textContent = '0 / 500';
        var provClear = document.getElementById(uid + '-provision');
        var tipClear = document.getElementById(uid + '-tip');
        if (provClear) provClear.value = '';
        if (tipClear) tipClear.value = '';

        // Reset status to worked
        if (statusSelect) statusSelect.value = 'worked';
        updateStatusVisibility();

        // Clear any remaining error states
        clearErrors();
      }

      // Quick confirm handler
      function onQuickConfirm() {
        clearErrors();
        var date = dateInput ? dateInput.value : _todayStr();
        if (!date) {
          setFieldError(uid + '-date-error', 'Bitte zuerst ein Datum auswählen.');
          return;
        }

        var result = quickConfirmDay(jobId, date);
        if (!result.success) {
          setFieldError(uid + '-hours-error', result.error);
          return;
        }

        // Clear inputs after successful quick confirm
        if (hoursInput) hoursInput.value = '';
        clearErrors();
      }

      // Note character counter
      function onNoteInput() {
        if (noteInput && noteCount) {
          noteCount.textContent = noteInput.value.length + ' / 500';
        }
      }

      // Bind events
      if (statusSelect) statusSelect.addEventListener('change', updateStatusVisibility);
      if (dateInput) dateInput.addEventListener('change', updateVacationIndicator);
      if (form) form.addEventListener('submit', onSubmit);
      if (quickBtn) quickBtn.addEventListener('click', onQuickConfirm);
      if (noteInput) noteInput.addEventListener('input', onNoteInput);

      // Initial visibility
      updateStatusVisibility();
    }

    return {
      init: init,
      createEntry: createEntry,
      updateEntry: updateEntry,
      deleteEntry: deleteEntry,
      getEntriesForDate: getEntriesForDate,
      getEntriesForMonth: getEntriesForMonth,
      quickConfirmDay: quickConfirmDay,
      validateEntry: validateEntry,
      renderInlineEntryRow: renderInlineEntryRow
    };
  })();

  // ─── LimitMonitorUI ──────────────────────────────────────────────────────────
  // Renders limit progress bars, KFB ring, and warning indicators in job cards.
  // Responds to EventBus events for auto-refresh.
  const LimitMonitorUI = (function () {
    let _initialized = false;
    let _refreshTimer = null;
    // Track rendered containers for refresh()
    let _renderedInstances = []; // { jobId, container, type: 'forJob' | 'kfbRing' }

    // Regulatory consequence messages for exceeded limits
    const EXCEEDED_MESSAGES = {
      'minijob_monthly': 'Minijob-Monatsgrenze (603 €) überschritten — Arbeitgeber schuldet ggf. volle Sozialversicherungsbeiträge und der Job verliert den steuerfreien Minijob-Status.',
      '26_week_rule': '26-Wochen-Regel überschritten — Werkstudenten-Privileg verloren; volle Sozialversicherungsbeiträge gelten rückwirkend.',
      'kfb_days': 'KFB-Jahresarbeitstage-Grenze (70 Tage) überschritten — Beschäftigung gilt nicht mehr als kurzfristig; volle Steuer- und Sozialversicherungspflicht.'
    };

    // Human-readable limit type labels
    const LIMIT_LABELS = {
      'minijob_monthly': 'Minijob Monatsgrenze',
      '26_week_rule': '26-Wochen-Regel',
      'kfb_days': 'KFB Jahrestage'
    };

    // Unit labels for current/remaining display
    const UNIT_LABELS = {
      'minijob_monthly': '€',
      '26_week_rule': 'Wochen',
      'kfb_days': 'Tage'
    };

    /**
     * Finds a job by ID from AppState.
     * @param {string} jobId
     * @returns {object|null}
     */
    function _findJob(jobId) {
      var jobs = AppState.getState().jobs;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === jobId) return jobs[i];
      }
      return null;
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Formats a value with its unit for display.
     * @param {number} value
     * @param {string} limitType
     * @returns {string}
     */
    function _formatValue(value, limitType) {
      var unit = UNIT_LABELS[limitType] || '';
      if (limitType === 'minijob_monthly') {
        return value.toFixed(2) + ' ' + unit;
      }
      return value + ' ' + unit;
    }

    /**
     * Renders a single limit status as HTML.
     * @param {object} limitStatus - LimitStatus object from LimitMonitor
     * @returns {string} HTML string
     */
    function _renderLimitItem(limitStatus) {
      var limitType = limitStatus.limitType;
      var label = LIMIT_LABELS[limitType] || limitType;
      var hasData = LimitMonitor.hasCalculationData(limitType, limitStatus.jobId);

      // If no calculation data, show placeholder
      if (!hasData) {
        return '<div class="limit-monitor-item">' +
          '<div class="dashboard-job-limit-label">' +
            '<span>' + _escapeHtml(label) + '</span>' +
          '</div>' +
          '<p class="limit-no-data">No data available</p>' +
        '</div>';
      }

      // Determine display level (suppression logic: only highest severity shown)
      var displayLevel = limitStatus.displayWarningLevel || limitStatus.warningLevel;
      var percentage = Math.round(limitStatus.percentage);
      // Cap display width at 100% for the bar
      var barWidth = Math.min(percentage, 100);

      var currentFormatted = _formatValue(limitStatus.current, limitType);
      var remainingFormatted = _formatValue(limitStatus.remaining, limitType);

      var html = '<div class="limit-monitor-item">';

      // Label row with badge
      html += '<div class="dashboard-job-limit-label">';
      html += '<span>' + _escapeHtml(label) + '</span>';
      html += '<span class="status-badge ' + displayLevel + '">' + percentage + '%</span>';
      html += '</div>';

      // Progress bar
      html += '<div class="progress-bar">';
      html += '<div class="progress-bar-fill ' + displayLevel + '" style="width: ' + barWidth + '%;"></div>';
      html += '</div>';

      // Current value and remaining capacity
      html += '<div class="limit-monitor-details">';
      html += '<span class="limit-current">' + currentFormatted + ' used</span>';
      html += '<span class="limit-remaining">' + remainingFormatted + ' remaining</span>';
      html += '</div>';

      // Exceeded message
      if (displayLevel === 'exceeded') {
        var msg = EXCEEDED_MESSAGES[limitType] || 'Gesetzliche Grenze überschritten.';
        html += '<div class="limit-exceeded-message">' + _escapeHtml(msg) + '</div>';
      }

      // Projection warning
      var projection = LimitMonitor.getProjection(limitType, limitStatus.jobId);
      if (projection && projection.status === 'available' && projection.willExceed && displayLevel !== 'exceeded') {
        html += '<div class="limit-projection-warning">⚠️ Voraussichtlich 100% vor Periodenende erreicht (' + projection.projectedPercentage + '% prognostiziert)</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders all limits in the daily dashboard (#dashboard-jobs-summary).
     * Calls LimitMonitor.checkAllLimits() and renders progress bars.
     */
    function renderLimits() {
      var container = document.getElementById('dashboard-jobs-summary');
      if (!container) return;

      var limits = LimitMonitor.checkAllLimits();
      var jobs = AppState.getState().jobs;

      // If no jobs configured, show empty state
      if (jobs.length === 0) {
        container.innerHTML = '<p class="daily-empty-state" id="dashboard-no-jobs">Keine Jobs konfiguriert.</p>';
        return;
      }

      var html = '';

      // Render per-job gross summary + limits
      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;

      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];

        // Skip ended jobs
        if (job.endDate) {
          var endDate = new Date(job.endDate + 'T23:59:59');
          if (endDate < now) continue;
        }

        var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, currentYear, currentMonth);

        html += '<div class="dashboard-job-item">';
        html += '<div class="dashboard-job-header">';
        html += '<span class="dashboard-job-name">' + _escapeHtml(job.employerName) + '</span>';
        html += '<span class="dashboard-job-gross">' + brutto.toFixed(2) + ' €</span>';
        html += '</div>';

        // Render applicable limits for this job
        html += '<div class="dashboard-job-limit">';
        var jobLimits = limits.filter(function (l) { return l.jobId === job.id; });
        for (var j = 0; j < jobLimits.length; j++) {
          html += _renderLimitItem(jobLimits[j]);
        }
        html += '</div>';

        html += '</div>';
      }

      // Render 26-week rule (not job-specific)
      var weekRule = limits.filter(function (l) { return l.limitType === '26_week_rule'; });
      if (weekRule.length > 0) {
        html += '<div class="dashboard-job-item">';
        html += '<div class="dashboard-job-header">';
        html += '<span class="dashboard-job-name">All Jobs (Combined)</span>';
        html += '<span class="dashboard-job-gross"></span>';
        html += '</div>';
        html += '<div class="dashboard-job-limit">';
        html += _renderLimitItem(weekRule[0]);
        html += '</div>';
        html += '</div>';
      }

      container.innerHTML = html;
    }

    /**
     * Renders a single job's limit in a specific container.
     * @param {string} jobId
     * @param {HTMLElement} container
     */
    function renderLimitForJob(jobId, container) {
      if (!container) return;

      var job = _findJob(jobId);
      if (!job) {
        container.innerHTML = '<p class="limit-no-data">Job nicht gefunden</p>';
        return;
      }

      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;
      var html = '';

      if (job.type === 'Minijob') {
        var status = LimitMonitor.checkMinijobLimit(job.id, currentYear, currentMonth);
        html += _renderLimitItem(status);
      }

      if (job.type === 'KFB') {
        var statusKFB = LimitMonitor.checkKFBDays(job.id, currentYear);
        html += _renderLimitItem(statusKFB);
      }

      // Also show 26-week rule if applicable
      if (job.type === 'Werkstudent' || job.type === 'Minijob' || job.type === 'KFB') {
        var status26 = LimitMonitor.check26WeekRule(currentYear);
        html += _renderLimitItem(status26);
      }

      if (!html) {
        container.innerHTML = '<p class="limit-no-data">Keine Limits für diesen Job-Typ.</p>';
        return;
      }

      container.innerHTML = html;
    }

    /**
     * Renders projected utilization for a job when user is entering/editing a WorkDay (before save).
     * Simulates adding the entry's hours to the current totals.
     * @param {string} jobId
     * @param {number} additionalHours - Hours being entered
     * @param {HTMLElement} container - Where to render the projection
     */
    function renderProjectedUtilization(jobId, additionalHours, container) {
      if (!container) return;

      var job = _findJob(jobId);
      if (!job) return;

      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;
      var html = '';

      if (job.type === 'Minijob') {
        var status = LimitMonitor.checkMinijobLimit(job.id, currentYear, currentMonth);
        if (status.status === 'available' || LimitMonitor.hasCalculationData('minijob_monthly', job.id)) {
          // Calculate projected with additional hours
          var rate = job.defaultHourlyRate || 0;
          var additionalEarnings = additionalHours * rate;
          var projectedCurrent = status.current + additionalEarnings;
          var projectedPercentage = status.limit > 0 ? Math.round((projectedCurrent / status.limit) * 100) : 0;
          var projectedLevel = LimitMonitor.getWarningLevel(projectedPercentage);
          var barWidth = Math.min(projectedPercentage, 100);

          html += '<div class="limit-monitor-item limit-projection">';
          html += '<div class="dashboard-job-limit-label">';
          html += '<span>Prognose: ' + _escapeHtml(LIMIT_LABELS['minijob_monthly']) + '</span>';
          html += '<span class="status-badge ' + projectedLevel + '">' + projectedPercentage + '%</span>';
          html += '</div>';
          html += '<div class="progress-bar">';
          html += '<div class="progress-bar-fill ' + projectedLevel + '" style="width: ' + barWidth + '%;"></div>';
          html += '</div>';
          html += '<div class="limit-monitor-details">';
          html += '<span class="limit-current">' + projectedCurrent.toFixed(2) + ' € nach Speichern</span>';
          html += '</div>';
          html += '</div>';
        }
      }

      if (job.type === 'KFB') {
        var statusKFB = LimitMonitor.checkKFBDays(job.id, currentYear);
        if (statusKFB.status === 'available' || LimitMonitor.hasCalculationData('kfb_days', job.id)) {
          // Adding one more day
          var projectedDays = statusKFB.current + 1;
          var projectedPct = statusKFB.limit > 0 ? Math.round((projectedDays / statusKFB.limit) * 100) : 0;
          var projLevel = LimitMonitor.getWarningLevel(projectedPct);
          var barW = Math.min(projectedPct, 100);

          html += '<div class="limit-monitor-item limit-projection">';
          html += '<div class="dashboard-job-limit-label">';
          html += '<span>Prognose: ' + _escapeHtml(LIMIT_LABELS['kfb_days']) + '</span>';
          html += '<span class="status-badge ' + projLevel + '">' + projectedPct + '%</span>';
          html += '</div>';
          html += '<div class="progress-bar">';
          html += '<div class="progress-bar-fill ' + projLevel + '" style="width: ' + barW + '%;"></div>';
          html += '</div>';
          html += '<div class="limit-monitor-details">';
          html += '<span class="limit-current">' + projectedDays + ' Tage nach Speichern</span>';
          html += '</div>';
          html += '</div>';
        }
      }

      container.innerHTML = html;
    }

    /**
     * Schedules a UI refresh within 2 seconds (debounced).
     */
    function _scheduleRefresh() {
      if (_refreshTimer) {
        clearTimeout(_refreshTimer);
      }
      _refreshTimer = setTimeout(function () {
        renderLimits();
        refresh();
        _refreshTimer = null;
      }, 500); // Refresh within 2 seconds (using 500ms for responsiveness)
    }

    /**
     * Renders the KFB Ring SVG progress indicator for a specific KFB job.
     * SVG circle (60×60px), stroke-dasharray = (daysUsed/maxDays) × circumference,
     * centered day count, "/70" below, color by threshold.
     * @param {string} jobId
     * @param {HTMLElement} container
     */
    function renderKFBRing(jobId, container) {
      if (!container) return;

      var job = _findJob(jobId);
      if (!job || job.type !== 'KFB') {
        container.innerHTML = '';
        return;
      }

      var now = new Date();
      var currentYear = now.getFullYear();
      var status = LimitMonitor.checkKFBDays(jobId, currentYear);

      var maxDays = status.limit || 70;
      var daysUsed = status.current || 0;
      var percentage = status.percentage || 0;
      var warningLevel = status.displayWarningLevel || status.warningLevel || 'safe';

      // SVG circle parameters
      var radius = 24;
      var circumference = 2 * Math.PI * radius;
      var progress = maxDays > 0 ? (daysUsed / maxDays) : 0;
      if (progress > 1) progress = 1;
      var dashArray = progress * circumference;
      var dashOffset = circumference - dashArray;

      // Determine color class
      var colorClass = '';
      if (percentage >= 95) {
        colorClass = ' danger';
      } else if (percentage >= 80) {
        colorClass = ' warning';
      }

      // Build SVG ring HTML
      var html = '<div class="kfb-ring-container">';
      html += '<svg class="kfb-ring-svg" viewBox="0 0 60 60" width="60" height="60">';
      html += '<circle class="kfb-ring-bg" cx="30" cy="30" r="' + radius + '" />';
      html += '<circle class="kfb-ring-progress' + colorClass + '" cx="30" cy="30" r="' + radius + '" ';
      html += 'stroke-dasharray="' + circumference + '" ';
      html += 'stroke-dashoffset="' + dashOffset + '" />';
      // Centered day count (large number) - transform to counteract the -90deg rotation on the SVG
      html += '<text x="30" y="28" text-anchor="middle" dominant-baseline="central" ';
      html += 'fill="var(--color-text-primary)" font-size="16" font-weight="700" ';
      html += 'transform="rotate(90 30 30)">' + daysUsed + '</text>';
      // "/70" below center
      html += '<text x="30" y="42" text-anchor="middle" dominant-baseline="central" ';
      html += 'fill="var(--color-text-secondary)" font-size="10" ';
      html += 'transform="rotate(90 30 30)">/' + maxDays + '</text>';
      html += '</svg>';

      // Info section beside the ring
      html += '<div class="kfb-ring-info">';
      html += '<span class="kfb-ring-label">KFB Tage</span>';
      html += '<span class="kfb-ring-value">' + daysUsed + ' / ' + maxDays + '</span>';
      html += '<span class="kfb-ring-detail">' + (maxDays - daysUsed) + ' Tage verbleibend</span>';
      html += '</div>';
      html += '</div>';

      // Projection warning
      var projection = LimitMonitor.getProjection('kfb_days', jobId);
      if (projection && projection.status === 'available' && projection.willExceed && warningLevel !== 'exceeded') {
        html += '<div class="limit-projection-warning">⚠️ Voraussichtlich ' + maxDays + ' Tage vor Jahresende erreicht (' + projection.projectedPercentage + '% prognostiziert)</div>';
      }

      // Exceeded message
      if (warningLevel === 'exceeded' || warningLevel === 'critical') {
        var msg = EXCEEDED_MESSAGES['kfb_days'];
        if (warningLevel === 'exceeded') {
          html += '<div class="limit-exceeded-message">' + _escapeHtml(msg) + '</div>';
        }
      }

      container.innerHTML = html;

      // Track for refresh
      _trackInstance(jobId, container, 'kfbRing');
    }

    /**
     * Renders the appropriate limit UI for a job based on its type.
     * - KFB: KFB Ring + rules info box
     * - Minijob: progress bar (brutto vs limit) + euro amount + percentage
     * - Werkstudent: 26-week rule progress for combined jobs
     * - All: rules info box with limit status, warning level, remaining capacity
     * @param {string} jobId
     * @param {HTMLElement} container
     */
    function renderForJob(jobId, container) {
      if (!container) return;

      var job = _findJob(jobId);
      if (!job) {
        container.innerHTML = '<p class="limit-no-data">Job nicht gefunden</p>';
        return;
      }

      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1;
      var html = '';

      if (job.type === 'KFB') {
        // Render KFB ring inline
        var ringContainer = document.createElement('div');
        container.innerHTML = '';
        container.appendChild(ringContainer);
        renderKFBRing(jobId, ringContainer);

        // Also show rules info box
        var statusKFB = LimitMonitor.checkKFBDays(jobId, currentYear);
        html = _renderRulesInfoBox(statusKFB);
        var infoDiv = document.createElement('div');
        infoDiv.innerHTML = html;
        container.appendChild(infoDiv);

        _trackInstance(jobId, container, 'forJob');
        return;
      }

      if (job.type === 'Minijob') {
        var statusMinijob = LimitMonitor.checkMinijobLimit(jobId, currentYear, currentMonth);
        html = _renderMinijobProgress(statusMinijob);
        html += _renderRulesInfoBox(statusMinijob);
        container.innerHTML = html;
        _trackInstance(jobId, container, 'forJob');
        return;
      }

      if (job.type === 'Werkstudent') {
        // 26-week rule progress for combined jobs
        var status26 = LimitMonitor.check26WeekRule(currentYear);
        html = _render26WeekProgress(status26);
        html += _renderRulesInfoBox(status26);
        container.innerHTML = html;
        _trackInstance(jobId, container, 'forJob');
        return;
      }

      // Teilzeit/Vollzeit - show any applicable limits (26-week if combined)
      container.innerHTML = '<p class="limit-no-data">Keine Limits für diesen Job-Typ.</p>';
      _trackInstance(jobId, container, 'forJob');
    }

    /**
     * Renders a Minijob progress bar showing current month brutto / limit.
     * @param {object} status - LimitStatus from LimitMonitor.checkMinijobLimit
     * @returns {string} HTML string
     */
    function _renderMinijobProgress(status) {
      var current = status.current || 0;
      var limit = status.limit || 603;
      var percentage = status.percentage || 0;
      var warningLevel = status.displayWarningLevel || status.warningLevel || 'safe';
      var barWidth = Math.min(percentage, 100);

      var html = '<div class="limit-monitor-item">';
      html += '<div class="dashboard-job-limit-label">';
      html += '<span>Monatsgrenze</span>';
      html += '<span class="status-badge ' + warningLevel + '">' + Math.round(percentage) + '%</span>';
      html += '</div>';

      // Progress bar
      html += '<div class="progress-bar">';
      html += '<div class="progress-bar-fill ' + warningLevel + '" style="width: ' + barWidth + '%;"></div>';
      html += '</div>';

      // Euro amount and percentage
      html += '<div class="limit-monitor-details">';
      html += '<span class="limit-current">' + current.toFixed(2) + ' € / ' + limit.toFixed(2) + ' €</span>';
      html += '<span class="limit-remaining">' + Math.max(0, limit - current).toFixed(2) + ' € verbleibend</span>';
      html += '</div>';

      // Projection warning
      var projection = LimitMonitor.getProjection('minijob_monthly', status.jobId);
      if (projection && projection.status === 'available' && projection.willExceed && warningLevel !== 'exceeded') {
        html += '<div class="limit-projection-warning">⚠️ Voraussichtlich 603 € vor Monatsende erreicht (' + projection.projectedPercentage + '% prognostiziert)</div>';
      }

      // Exceeded message
      if (warningLevel === 'exceeded') {
        html += '<div class="limit-exceeded-message">' + _escapeHtml(EXCEEDED_MESSAGES['minijob_monthly']) + '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders 26-week rule progress bar for Werkstudent combined jobs.
     * @param {object} status - LimitStatus from LimitMonitor.check26WeekRule
     * @returns {string} HTML string
     */
    function _render26WeekProgress(status) {
      var current = status.current || 0;
      var limit = status.limit || 26;
      var percentage = status.percentage || 0;
      var warningLevel = status.displayWarningLevel || status.warningLevel || 'safe';
      var barWidth = Math.min(percentage, 100);

      var html = '<div class="limit-monitor-item">';
      html += '<div class="dashboard-job-limit-label">';
      html += '<span>26-Wochen-Regel</span>';
      html += '<span class="status-badge ' + warningLevel + '">' + Math.round(percentage) + '%</span>';
      html += '</div>';

      // Progress bar
      html += '<div class="progress-bar">';
      html += '<div class="progress-bar-fill ' + warningLevel + '" style="width: ' + barWidth + '%;"></div>';
      html += '</div>';

      // Details
      html += '<div class="limit-monitor-details">';
      html += '<span class="limit-current">' + current + ' / ' + limit + ' Wochen</span>';
      html += '<span class="limit-remaining">' + Math.max(0, limit - current) + ' Wochen verbleibend</span>';
      html += '</div>';

      // Projection warning
      var projection = LimitMonitor.getProjection('26_week_rule');
      if (projection && projection.status === 'available' && projection.willExceed && warningLevel !== 'exceeded') {
        html += '<div class="limit-projection-warning">⚠️ Voraussichtlich 26 Wochen vor Jahresende erreicht (' + projection.projectedPercentage + '% prognostiziert)</div>';
      }

      // Exceeded message
      if (warningLevel === 'exceeded') {
        html += '<div class="limit-exceeded-message">' + _escapeHtml(EXCEEDED_MESSAGES['26_week_rule']) + '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders a rules info box for a job card showing limit status, warning level, remaining capacity.
     * Shows red color + regulatory consequence message for critical/exceeded.
     * @param {object} status - LimitStatus object
     * @returns {string} HTML string
     */
    function _renderRulesInfoBox(status) {
      if (!status || status.status === 'unavailable') return '';

      var limitType = status.limitType;
      var label = LIMIT_LABELS[limitType] || limitType;
      var warningLevel = status.displayWarningLevel || status.warningLevel || 'safe';
      var percentage = Math.round(status.percentage || 0);
      var remaining = status.remaining || 0;
      var unit = UNIT_LABELS[limitType] || '';

      var remainingText = limitType === 'minijob_monthly'
        ? remaining.toFixed(2) + ' ' + unit
        : remaining + ' ' + unit;

      var html = '<div class="limit-monitor-item">';
      html += '<div class="dashboard-job-limit-label">';
      html += '<span>' + _escapeHtml(label) + '</span>';
      html += '<span class="status-badge ' + warningLevel + '">' + percentage + '%</span>';
      html += '</div>';

      // Status text
      var statusText = '';
      if (warningLevel === 'safe') {
        statusText = 'Im sicheren Bereich';
      } else if (warningLevel === 'warning') {
        statusText = 'Achtung: Grenze nähert sich';
      } else if (warningLevel === 'critical') {
        statusText = 'Kritisch: Fast erreicht';
      } else if (warningLevel === 'exceeded') {
        statusText = 'Überschritten!';
      }

      html += '<div class="limit-monitor-details">';
      html += '<span class="limit-current"' + (warningLevel === 'critical' || warningLevel === 'exceeded' ? ' style="color: var(--color-danger);"' : '') + '>' + statusText + '</span>';
      html += '<span class="limit-remaining">' + remainingText + ' verbleibend</span>';
      html += '</div>';

      // Regulatory consequence message for critical/exceeded (red)
      if (warningLevel === 'exceeded') {
        var msg = EXCEEDED_MESSAGES[limitType] || 'Gesetzliche Grenze überschritten.';
        html += '<div class="limit-exceeded-message">' + _escapeHtml(msg) + '</div>';
      } else if (warningLevel === 'critical') {
        var critMsg = 'Kritischer Bereich erreicht — bei Überschreitung drohen regulatorische Konsequenzen.';
        html += '<div class="limit-exceeded-message">' + _escapeHtml(critMsg) + '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Tracks a rendered instance for later refresh.
     * @param {string} jobId
     * @param {HTMLElement} container
     * @param {string} type - 'forJob' or 'kfbRing'
     */
    function _trackInstance(jobId, container, type) {
      // Remove existing entry for same container
      _renderedInstances = _renderedInstances.filter(function (inst) {
        return inst.container !== container;
      });
      _renderedInstances.push({ jobId: jobId, container: container, type: type });
    }

    /**
     * Re-renders all currently displayed limit UIs.
     * Cleans up instances whose containers are no longer in the DOM.
     */
    function refresh() {
      // Clean up detached containers
      _renderedInstances = _renderedInstances.filter(function (inst) {
        return document.body.contains(inst.container);
      });

      // Re-render each tracked instance
      for (var i = 0; i < _renderedInstances.length; i++) {
        var inst = _renderedInstances[i];
        if (inst.type === 'kfbRing') {
          renderKFBRing(inst.jobId, inst.container);
        } else if (inst.type === 'forJob') {
          renderForJob(inst.jobId, inst.container);
        }
      }
    }

    /**
     * Initializes the LimitMonitorUI module.
     * Subscribes to EventBus events and performs initial render.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Subscribe to limits:updated event for auto-refresh
      EventBus.on('limits:updated', function () {
        _scheduleRefresh();
      });

      // Subscribe to EventBus events for auto-refresh
      EventBus.on('workday:saved', function () {
        _scheduleRefresh();
      });

      EventBus.on('workday:deleted', function () {
        _scheduleRefresh();
      });

      // Also refresh on job changes
      EventBus.on('job:created', function () {
        _scheduleRefresh();
      });

      EventBus.on('job:updated', function () {
        _scheduleRefresh();
      });

      EventBus.on('job:deleted', function () {
        _scheduleRefresh();
      });

      // Initial render
      renderLimits();
    }

    return {
      init: init,
      renderLimits: renderLimits,
      renderLimitForJob: renderLimitForJob,
      renderForJob: renderForJob,
      renderKFBRing: renderKFBRing,
      refresh: refresh,
      renderProjectedUtilization: renderProjectedUtilization
    };
  })();

  // ─── PersonalDataModule ───────────────────────────────────────────────────────
  // Manages the "Persönliche Daten" section in Einstellungen.
  // Displays current tax profile, allows editing with validation,
  // warns when clearing required fields, persists changes, emits profile:updated.
  const PersonalDataModule = (function () {
    let _initialized = false;
    let _editing = false;

    const BUNDESLAENDER = [
      'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen',
      'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen',
      'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen',
      'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'
    ];

    const STEUERKLASSE_LABELS = {
      1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI'
    };

    /**
     * Gets the current user profile from AppState.
     * @returns {object|null}
     */
    function _getProfile() {
      var state = AppState.getState();
      return state.userProfile || null;
    }

    /**
     * Renders the read-only display of personal data.
     */
    function _renderDisplay() {
      var container = document.getElementById('settings-personal-data');
      if (!container) return;

      var profile = _getProfile();
      var steuerklasse = profile && profile.steuerklasse ? STEUERKLASSE_LABELS[profile.steuerklasse] || profile.steuerklasse : '—';
      var bundesland = profile && profile.bundesland ? profile.bundesland : '—';
      var kirchensteuer = profile && profile.kirchensteuer ? 'Ja' : 'Nein';
      var kvTyp = profile && profile.krankenversicherung ? (profile.krankenversicherung === 'gesetzlich' ? 'Gesetzlich' : 'Privat') : '—';
      var hasChildren = profile && profile.hasChildren ? 'Ja' : 'Nein';

      var html = '';
      html += '<div class="personal-data-display">';
      html += '<dl class="personal-data-list">';
      html += '<div class="personal-data-item"><dt>Steuerklasse</dt><dd>' + _escapeHtml(String(steuerklasse)) + '</dd></div>';
      html += '<div class="personal-data-item"><dt>Bundesland</dt><dd>' + _escapeHtml(String(bundesland)) + '</dd></div>';
      html += '<div class="personal-data-item"><dt>Kirchensteuer</dt><dd>' + _escapeHtml(kirchensteuer) + '</dd></div>';
      html += '<div class="personal-data-item"><dt>Kinder (unter 25)</dt><dd>' + _escapeHtml(hasChildren) + '</dd></div>';
      html += '<div class="personal-data-item"><dt>Krankenversicherung</dt><dd>' + _escapeHtml(kvTyp) + '</dd></div>';
      html += '</dl>';
      html += '<button type="button" class="btn btn-secondary personal-data-edit-btn" id="personal-data-edit-btn">Bearbeiten</button>';
      html += '</div>';

      container.innerHTML = html;
      _editing = false;

      // Wire edit button
      var editBtn = document.getElementById('personal-data-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', _renderEditForm);
      }
    }

    /**
     * Renders the edit form for personal data.
     */
    function _renderEditForm() {
      var container = document.getElementById('settings-personal-data');
      if (!container) return;

      var profile = _getProfile();
      var currentSteuerklasse = profile && profile.steuerklasse ? profile.steuerklasse : '';
      var currentBundesland = profile && profile.bundesland ? profile.bundesland : '';
      var currentKirchensteuer = profile && profile.kirchensteuer ? true : false;
      var currentKV = profile && profile.krankenversicherung ? profile.krankenversicherung : '';
      var currentHasChildren = profile && profile.hasChildren ? true : false;

      var html = '';
      html += '<form id="personal-data-form" class="personal-data-form" novalidate>';

      // Steuerklasse
      html += '<div class="form-group">';
      html += '<label class="form-label" for="pd-steuerklasse">Steuerklasse *</label>';
      html += '<select id="pd-steuerklasse" class="form-select" required aria-required="true">';
      html += '<option value="">— Auswählen —</option>';
      for (var i = 1; i <= 6; i++) {
        var selected = (currentSteuerklasse === i) ? ' selected' : '';
        html += '<option value="' + i + '"' + selected + '>Steuerklasse ' + STEUERKLASSE_LABELS[i] + '</option>';
      }
      html += '</select>';
      html += '<span class="field-error" id="pd-steuerklasse-error" aria-live="polite"></span>';
      html += '</div>';

      // Bundesland
      html += '<div class="form-group">';
      html += '<label class="form-label" for="pd-bundesland">Bundesland *</label>';
      html += '<select id="pd-bundesland" class="form-select" required aria-required="true">';
      html += '<option value="">— Auswählen —</option>';
      for (var b = 0; b < BUNDESLAENDER.length; b++) {
        var blSelected = (currentBundesland === BUNDESLAENDER[b]) ? ' selected' : '';
        html += '<option value="' + _escapeHtml(BUNDESLAENDER[b]) + '"' + blSelected + '>' + _escapeHtml(BUNDESLAENDER[b]) + '</option>';
      }
      html += '</select>';
      html += '<span class="field-error" id="pd-bundesland-error" aria-live="polite"></span>';
      html += '</div>';

      // Kirchensteuer
      html += '<div class="form-group">';
      html += '<label class="form-label">Kirchensteuer</label>';
      html += '<div class="toggle-group">';
      html += '<label class="toggle-label" for="pd-kirchensteuer">';
      html += '<input type="checkbox" id="pd-kirchensteuer" class="toggle-input"' + (currentKirchensteuer ? ' checked' : '') + '>';
      html += '<span class="toggle-switch"></span>';
      html += '<span class="toggle-text">Kirchensteuer zahlen</span>';
      html += '</label>';
      html += '</div>';
      html += '</div>';

      // Kinder
      html += '<div class="form-group">';
      html += '<label class="form-label">Kinder</label>';
      html += '<div class="toggle-group">';
      html += '<label class="toggle-label" for="pd-has-children">';
      html += '<input type="checkbox" id="pd-has-children" class="toggle-input"' + (currentHasChildren ? ' checked' : '') + '>';
      html += '<span class="toggle-switch"></span>';
      html += '<span class="toggle-text">Ich habe Kinder (unter 25)</span>';
      html += '</label>';
      html += '</div>';
      html += '</div>';

      // KV-Typ
      html += '<div class="form-group">';
      html += '<label class="form-label" id="pd-kv-label">Krankenversicherung *</label>';
      html += '<div class="radio-group" role="radiogroup" aria-labelledby="pd-kv-label">';
      html += '<label class="radio-label">';
      html += '<input type="radio" name="pd-krankenversicherung" value="gesetzlich" class="radio-input"' + (currentKV === 'gesetzlich' ? ' checked' : '') + '>';
      html += '<span class="radio-custom"></span>';
      html += '<span class="radio-text">Gesetzlich</span>';
      html += '</label>';
      html += '<label class="radio-label">';
      html += '<input type="radio" name="pd-krankenversicherung" value="privat" class="radio-input"' + (currentKV === 'privat' ? ' checked' : '') + '>';
      html += '<span class="radio-custom"></span>';
      html += '<span class="radio-text">Privat</span>';
      html += '</label>';
      html += '</div>';
      html += '<span class="field-error" id="pd-kv-error" aria-live="polite"></span>';
      html += '</div>';

      // Warning area
      html += '<div id="pd-warning" class="personal-data-warning" style="display:none;" role="alert" aria-live="polite"></div>';

      // Actions
      html += '<div class="form-actions">';
      html += '<button type="submit" class="btn btn-primary">Speichern</button>';
      html += '<button type="button" id="pd-cancel-btn" class="btn btn-secondary">Abbrechen</button>';
      html += '</div>';

      html += '</form>';

      container.innerHTML = html;
      _editing = true;

      // Wire form events
      var form = document.getElementById('personal-data-form');
      if (form) {
        form.addEventListener('submit', _handleSave);
      }

      var cancelBtn = document.getElementById('pd-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', _renderDisplay);
      }

      // Wire change listeners for warning display
      var steuerklasseSelect = document.getElementById('pd-steuerklasse');
      var bundeslandSelect = document.getElementById('pd-bundesland');
      if (steuerklasseSelect) {
        steuerklasseSelect.addEventListener('change', _checkWarning);
      }
      if (bundeslandSelect) {
        bundeslandSelect.addEventListener('change', _checkWarning);
      }
    }

    /**
     * Checks if required fields are being cleared and shows warning.
     */
    function _checkWarning() {
      var steuerklasseEl = document.getElementById('pd-steuerklasse');
      var bundeslandEl = document.getElementById('pd-bundesland');
      var warningEl = document.getElementById('pd-warning');
      if (!steuerklasseEl || !bundeslandEl || !warningEl) return;

      var steuerklasse = steuerklasseEl.value;
      var bundesland = bundeslandEl.value;

      if (!steuerklasse || !bundesland) {
        warningEl.textContent = '⚠️ Ohne Steuerklasse und Bundesland können keine Netto-Berechnungen für Teilzeit/Vollzeit-Jobs durchgeführt werden.';
        warningEl.style.display = 'block';
      } else {
        warningEl.style.display = 'none';
        warningEl.textContent = '';
      }
    }

    /**
     * Handles the save action from the edit form.
     * @param {Event} e
     */
    function _handleSave(e) {
      e.preventDefault();

      // Collect values
      var steuerklasseEl = document.getElementById('pd-steuerklasse');
      var bundeslandEl = document.getElementById('pd-bundesland');
      var kirchensteuerEl = document.getElementById('pd-kirchensteuer');
      var hasChildrenEl = document.getElementById('pd-has-children');
      var kvRadios = document.querySelectorAll('input[name="pd-krankenversicherung"]');

      var steuerklasse = steuerklasseEl ? steuerklasseEl.value : '';
      var bundesland = bundeslandEl ? bundeslandEl.value : '';
      var kirchensteuer = kirchensteuerEl ? kirchensteuerEl.checked : false;
      var hasChildren = hasChildrenEl ? hasChildrenEl.checked : false;
      var krankenversicherung = '';
      for (var r = 0; r < kvRadios.length; r++) {
        if (kvRadios[r].checked) {
          krankenversicherung = kvRadios[r].value;
          break;
        }
      }

      // Validate
      var valid = true;

      // Clear previous errors
      _clearError('pd-steuerklasse-error');
      _clearError('pd-bundesland-error');
      _clearError('pd-kv-error');

      if (!steuerklasse) {
        _setError('pd-steuerklasse-error', 'Steuerklasse ist erforderlich.');
        if (steuerklasseEl) steuerklasseEl.classList.add('input-error');
        valid = false;
      } else {
        if (steuerklasseEl) steuerklasseEl.classList.remove('input-error');
      }

      if (!bundesland) {
        _setError('pd-bundesland-error', 'Bundesland ist erforderlich.');
        if (bundeslandEl) bundeslandEl.classList.add('input-error');
        valid = false;
      } else {
        if (bundeslandEl) bundeslandEl.classList.remove('input-error');
      }

      if (!krankenversicherung) {
        _setError('pd-kv-error', 'Krankenversicherung ist erforderlich.');
        valid = false;
      }

      if (!valid) return;

      // Build profile object
      var profile = _getProfile() || {};
      profile.steuerklasse = parseInt(steuerklasse, 10);
      profile.bundesland = bundesland;
      profile.kirchensteuer = kirchensteuer;
      profile.hasChildren = hasChildren;
      profile.krankenversicherung = krankenversicherung;
      profile.updatedAt = new Date().toISOString();
      if (!profile.createdAt) {
        profile.createdAt = profile.updatedAt;
      }

      // Persist
      var result = AppState.setState('userProfile', profile);
      if (!result.success) {
        showToast('Speichern fehlgeschlagen. Bitte erneut versuchen.');
        return;
      }

      // Emit profile:updated event
      EventBus.emit('profile:updated', { profile: profile });

      // Show success
      showToast('Persönliche Daten gespeichert.');

      // Switch back to display mode
      _renderDisplay();
    }

    /**
     * Sets an error message on a field error element.
     * @param {string} id
     * @param {string} message
     */
    function _setError(id, message) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = message;
      }
    }

    /**
     * Clears an error message.
     * @param {string} id
     */
    function _clearError(id) {
      var el = document.getElementById(id);
      if (el) {
        el.textContent = '';
      }
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Initializes the PersonalDataModule.
     * Renders the display view and subscribes to relevant events.
     */
    function init() {
      if (_initialized) {
        // Re-render on subsequent inits (e.g., after data:imported)
        _renderDisplay();
        return;
      }
      _initialized = true;
      _renderDisplay();

      // Subscribe to data:imported to refresh display
      EventBus.on('data:imported', function () {
        _renderDisplay();
      });

      // Subscribe to profile:updated from other sources (e.g., onboarding)
      EventBus.on('profile:updated', function () {
        if (!_editing) {
          _renderDisplay();
        }
      });
    }

    return {
      init: init
    };
  })();

  // ─── ExportImportModule ──────────────────────────────────────────────────────
  // Handles data backup (export) and restore (import) via JSON files.
  // Wires export/import buttons in the settings view.
  const ExportImportModule = (function () {
    const APP_VERSION = '1.0.0';
    const CURRENT_SCHEMA_VERSION = 1;

    /**
     * Generates a JSON export string on demand from current localStorage state.
     * No pre-computed or cached export — always reflects latest data.
     * @returns {string} JSON string with full export schema
     */
    function exportToJSON() {
      var dataString = LocalStorageManager.exportAll();
      var data;
      try {
        data = JSON.parse(dataString);
      } catch (e) {
        data = {};
      }

      var exportObj = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        data: {
          userProfile: data.jt_user_profile || null,
          jobs: data.jt_jobs || [],
          workdays: data.jt_workdays || [],
          earningsExtra: data.jt_earnings_extra || [],
          ruleConfig: data.jt_rule_config || {},
          appState: data.jt_app_state || {}
        }
      };

      return JSON.stringify(exportObj, null, 2);
    }

    /**
     * Triggers a file download of the given JSON string.
     * Creates a Blob, generates an object URL, and triggers download via hidden anchor click.
     * @param {string} jsonString - The JSON content to download
     * @param {string} filename - The filename for the download
     */
    function triggerDownload(jsonString, filename) {
      var blob = new Blob([jsonString], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      // Clean up
      setTimeout(function () {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }, 100);
    }

    /**
     * Validates an import file JSON string.
     * Checks: valid JSON, required fields, schema version compatibility.
     * German error messages for user-facing feedback (Requirement 14.5).
     * @param {string} jsonString - The JSON string to validate
     * @returns {{ valid: boolean, errors: string[], schemaVersion?: number }}
     */
    function validateImportFile(jsonString) {
      var errors = [];
      var parsed;

      // Check valid JSON
      try {
        parsed = JSON.parse(jsonString);
      } catch (e) {
        return { valid: false, errors: ['Ungültiges JSON-Format: Die Datei enthält kein gültiges JSON.'] };
      }

      // Check it's an object
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, errors: ['Import-Datei muss ein JSON-Objekt sein.'] };
      }

      // Check required top-level fields
      if (typeof parsed.schemaVersion === 'undefined') {
        errors.push('Pflichtfeld fehlt: schemaVersion');
      }
      if (typeof parsed.exportedAt === 'undefined') {
        errors.push('Pflichtfeld fehlt: exportedAt');
      }
      if (typeof parsed.appVersion === 'undefined') {
        errors.push('Pflichtfeld fehlt: appVersion');
      }
      if (typeof parsed.data === 'undefined' || parsed.data === null || typeof parsed.data !== 'object') {
        errors.push('Pflichtfeld fehlt oder ungültig: data');
      }

      if (errors.length > 0) {
        return { valid: false, errors: errors };
      }

      // Validate schema version compatibility
      var schemaVersion = parsed.schemaVersion;
      if (typeof schemaVersion !== 'number' || schemaVersion < 1) {
        return { valid: false, errors: ['Ungültige Schema-Version: ' + schemaVersion + '. Erwartet wird eine positive Zahl.'] };
      }
      if (schemaVersion > CURRENT_SCHEMA_VERSION) {
        return { valid: false, errors: ['Nicht unterstützte Schema-Version: ' + schemaVersion + '. Diese App unterstützt bis Version ' + CURRENT_SCHEMA_VERSION + '.'] };
      }

      // Validate required data fields
      var data = parsed.data;
      var requiredDataFields = ['userProfile', 'jobs', 'workdays', 'earningsExtra', 'ruleConfig', 'appState'];
      for (var i = 0; i < requiredDataFields.length; i++) {
        if (typeof data[requiredDataFields[i]] === 'undefined') {
          errors.push('Pflichtfeld in data fehlt: ' + requiredDataFields[i]);
        }
      }

      if (errors.length > 0) {
        return { valid: false, errors: errors };
      }

      return { valid: true, errors: [], schemaVersion: schemaVersion };
    }

    /**
     * Imports data from a JSON string after validation and user confirmation.
     * On confirm: overwrites all localStorage data, reloads AppState, emits data:imported.
     * On invalid: displays error with reason, preserves existing data.
     * @param {string} jsonString - The JSON string to import
     * @returns {{ success: boolean, error?: string }}
     */
    function importFromJSON(jsonString) {
      // Validate first
      var validation = validateImportFile(jsonString);
      if (!validation.valid) {
        _showImportError(validation.errors.join('; '));
        return { success: false, error: validation.errors.join('; ') };
      }

      // Show confirmation prompt
      var confirmed = confirm('Import überschreibt alle vorhandenen Daten. Dies kann nicht rückgängig gemacht werden. Fortfahren?');
      if (!confirmed) {
        return { success: false, error: 'cancelled' };
      }

      // Parse the data
      var parsed;
      try {
        parsed = JSON.parse(jsonString);
      } catch (e) {
        _showImportError('Daten konnten nicht gelesen werden.');
        return { success: false, error: 'parse_failed' };
      }

      // Build the storage object from the export schema
      var storageData = {};
      storageData.jt_schema_version = parsed.schemaVersion || CURRENT_SCHEMA_VERSION;
      if (parsed.data) {
        if (parsed.data.userProfile !== undefined) storageData.jt_user_profile = parsed.data.userProfile;
        if (parsed.data.jobs !== undefined) storageData.jt_jobs = parsed.data.jobs;
        if (parsed.data.workdays !== undefined) storageData.jt_workdays = parsed.data.workdays;
        if (parsed.data.earningsExtra !== undefined) storageData.jt_earnings_extra = parsed.data.earningsExtra;
        if (parsed.data.ruleConfig !== undefined) storageData.jt_rule_config = parsed.data.ruleConfig;
        if (parsed.data.appState !== undefined) storageData.jt_app_state = parsed.data.appState;
      }

      // Use LocalStorageManager.importAll() to overwrite localStorage
      var importResult = LocalStorageManager.importAll(JSON.stringify(storageData));
      if (!importResult.success) {
        _showImportError('Daten konnten nicht gespeichert werden: ' + (importResult.error || 'Unbekannter Fehler'));
        return { success: false, error: importResult.error };
      }

      // Reload AppState from localStorage
      AppState.initApp();

      // Emit data:imported event
      EventBus.emit('data:imported', {});

      // Show success feedback
      showToast('Daten erfolgreich importiert.');

      return { success: true };
    }

    /**
     * Displays an import error message to the user.
     * @param {string} message
     */
    function _showImportError(message) {
      showToast('Import fehlgeschlagen: ' + message);
    }

    /**
     * Initializes the ExportImportModule.
     * Wires export/import buttons in the settings view.
     */
    function init() {
      // Wire export button
      var exportBtn = document.getElementById('settings-export-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', function () {
          var json = exportToJSON();
          var date = new Date().toISOString().slice(0, 10);
          var filename = 'jobtracker-backup-' + date + '.json';
          triggerDownload(json, filename);
        });
      }

      // Wire import button to trigger file input
      var importBtn = document.getElementById('settings-import-btn');
      var importFile = document.getElementById('settings-import-file');
      if (importBtn && importFile) {
        importBtn.addEventListener('click', function () {
          importFile.value = ''; // Reset so same file can be re-selected
          importFile.click();
        });
      }

      // Wire file input change event to read, validate, and import
      if (importFile) {
        importFile.addEventListener('change', function (e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;

          var reader = new FileReader();
          reader.onload = function (evt) {
            var jsonString = evt.target.result;
            importFromJSON(jsonString);
          };
          reader.onerror = function () {
            _showImportError('Datei konnte nicht gelesen werden.');
          };
          reader.readAsText(file);
        });
      }

      // Wire reset all button
      var resetBtn = document.getElementById('settings-reset-all-btn');
      var resetModal = document.getElementById('reset-all-modal');
      var resetConfirmBtn = document.getElementById('reset-all-confirm-btn');
      var resetCancelBtn = document.getElementById('reset-all-cancel-btn');

      if (resetBtn && resetModal) {
        resetBtn.addEventListener('click', function () {
          resetModal.classList.add('active');
        });
      }
      if (resetCancelBtn && resetModal) {
        resetCancelBtn.addEventListener('click', function () {
          resetModal.classList.remove('active');
        });
      }
      if (resetConfirmBtn && resetModal) {
        resetConfirmBtn.addEventListener('click', function () {
          resetModal.classList.remove('active');
          _resetAllData();
        });
      }
    }

    /**
     * Resets all application data and restarts onboarding.
     */
    function _resetAllData() {
      // Clear all localStorage keys
      LocalStorageManager.remove('jt_schema_version');
      LocalStorageManager.remove('jt_user_profile');
      LocalStorageManager.remove('jt_jobs');
      LocalStorageManager.remove('jt_workdays');
      LocalStorageManager.remove('jt_earnings_extra');
      LocalStorageManager.remove('jt_rule_config');
      LocalStorageManager.remove('jt_app_state');

      // Reload the page to restart fresh (triggers onboarding)
      window.location.reload();
    }

    return {
      exportToJSON: exportToJSON,
      triggerDownload: triggerDownload,
      validateImportFile: validateImportFile,
      importFromJSON: importFromJSON,
      init: init
    };
  })();

  // ─── MonthlyOverviewModule ───────────────────────────────────────────────────
  // Renders the monthly overview view: month/year selector, per-job summaries,
  // day-by-day list, and aggregated totals.
  const MonthlyOverviewModule = (function () {
    let _initialized = false;
    let _selectedYear = new Date().getFullYear();
    let _selectedMonth = new Date().getMonth() + 1; // 1-12

    const MONTH_NAMES = [
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
    ];

    // ── Helpers ──

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Formats a number as currency (2 decimal places with € symbol).
     * @param {number} val
     * @returns {string}
     */
    function _formatCurrency(val) {
      return (val || 0).toFixed(2) + ' €';
    }

    /**
     * Finds a job by ID from AppState.
     * @param {string} jobId
     * @returns {object|null}
     */
    function _findJob(jobId) {
      var jobs = AppState.getState().jobs;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === jobId) return jobs[i];
      }
      return null;
    }

    /**
     * Updates the month/year label display.
     */
    function _updateLabel() {
      var label = document.getElementById('monthly-current-label');
      if (label) {
        label.textContent = MONTH_NAMES[_selectedMonth - 1] + ' ' + _selectedYear;
      }
    }

    /**
     * Navigates to the previous month.
     */
    function _prevMonth() {
      _selectedMonth--;
      if (_selectedMonth < 1) {
        _selectedMonth = 12;
        _selectedYear--;
      }
      _render();
    }

    /**
     * Navigates to the next month.
     */
    function _nextMonth() {
      _selectedMonth++;
      if (_selectedMonth > 12) {
        _selectedMonth = 1;
        _selectedYear++;
      }
      _render();
    }

    /**
     * Calculates total hours worked for a job in the selected month.
     * @param {string} jobId
     * @returns {number}
     */
    function _getTotalHoursForJob(jobId) {
      var entries = TimeTrackerModule.getEntriesForMonth(_selectedYear, _selectedMonth, jobId);
      var total = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].status === 'worked' && entries[i].hours) {
          total += entries[i].hours;
        }
      }
      return total;
    }

    /**
     * Counts total days worked for a job in the selected month.
     * @param {string} jobId
     * @returns {number}
     */
    function _getDaysWorkedForJob(jobId) {
      var entries = TimeTrackerModule.getEntriesForMonth(_selectedYear, _selectedMonth, jobId);
      var datesSet = {};
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].status === 'worked') {
          datesSet[entries[i].date] = true;
        }
      }
      return Object.keys(datesSet).length;
    }

    /**
     * Renders the aggregated totals section.
     */
    function _renderAggregated() {
      var aggregated = IncomeEngine.getAggregatedMonthly(_selectedYear, _selectedMonth);

      // Calculate total hours across all jobs
      var jobs = AppState.getState().jobs;
      var totalHours = 0;
      for (var i = 0; i < jobs.length; i++) {
        totalHours += _getTotalHoursForJob(jobs[i].id);
      }

      var hoursEl = document.getElementById('monthly-agg-hours');
      var bruttoEl = document.getElementById('monthly-agg-brutto');
      var nettoEl = document.getElementById('monthly-agg-netto');
      var provisionsEl = document.getElementById('monthly-agg-provisions');
      var tipsEl = document.getElementById('monthly-agg-tips');

      if (hoursEl) hoursEl.textContent = totalHours.toFixed(1);
      if (bruttoEl) bruttoEl.textContent = _formatCurrency(aggregated.totalBrutto);
      if (nettoEl) {
        if (aggregated.nettoAvailable) {
          nettoEl.textContent = _formatCurrency(aggregated.nettoCashflow);
        } else {
          nettoEl.textContent = 'N/A';
        }
      }

      // Provision and tip totals
      var totalProvisions = 0;
      var totalTips = aggregated.totalTips;
      for (var j = 0; j < aggregated.perJob.length; j++) {
        totalProvisions += aggregated.perJob[j].provisions;
      }

      if (provisionsEl) provisionsEl.textContent = 'Provision: ' + _formatCurrency(totalProvisions);
      if (tipsEl) tipsEl.textContent = 'Trinkgeld: ' + _formatCurrency(totalTips);
    }

    /**
     * Renders per-job summary cards.
     */
    function _renderJobSummaries() {
      var container = document.getElementById('monthly-job-summaries');
      if (!container) return;

      var jobs = AppState.getState().jobs;

      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<p class="monthly-empty-state">Keine Jobs konfiguriert.</p>';
        return;
      }

      var html = '';
      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        var daysWorked = _getDaysWorkedForJob(job.id);
        var totalHours = _getTotalHoursForJob(job.id);
        var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, _selectedYear, _selectedMonth);
        var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, _selectedYear, _selectedMonth);
        var provisions = IncomeEngine.getProvisionTotal(job.id, _selectedYear, _selectedMonth);
        var tips = IncomeEngine.getTipTotal(job.id, _selectedYear, _selectedMonth);

        // Limit utilization (if applicable)
        var limitHtml = '';
        if (job.type === 'Minijob') {
          var limitStatus = LimitMonitor.checkMinijobLimit(job.id, _selectedYear, _selectedMonth);
          if (limitStatus.status !== 'unavailable') {
            var pct = Math.round(limitStatus.percentage);
            var level = limitStatus.displayWarningLevel || limitStatus.warningLevel;
            limitHtml = '<div class="monthly-job-limit">';
            limitHtml += '<span class="monthly-limit-label">Limit: ' + pct + '%</span>';
            limitHtml += '<div class="progress-bar"><div class="progress-bar-fill ' + level + '" style="width:' + Math.min(pct, 100) + '%"></div></div>';
            limitHtml += '</div>';
          }
        } else if (job.type === 'KFB') {
          var kfbStatus = LimitMonitor.checkKFBDays(job.id, _selectedYear);
          if (kfbStatus.status !== 'unavailable') {
            var kfbPct = Math.round(kfbStatus.percentage);
            var kfbLevel = kfbStatus.displayWarningLevel || kfbStatus.warningLevel;
            limitHtml = '<div class="monthly-job-limit">';
            limitHtml += '<span class="monthly-limit-label">KFB Tage: ' + kfbPct + '%</span>';
            limitHtml += '<div class="progress-bar"><div class="progress-bar-fill ' + kfbLevel + '" style="width:' + Math.min(kfbPct, 100) + '%"></div></div>';
            limitHtml += '</div>';
          }
        }

        html += '<div class="glass-surface layer-content monthly-card monthly-job-card">';
        html += '<h3 class="monthly-job-name">' + _escapeHtml(job.employerName) + ' <span class="monthly-job-type-badge">' + _escapeHtml(job.type) + '</span></h3>';
        html += '<div class="monthly-job-stats">';
        html += '<div class="monthly-stat-sm"><span class="monthly-stat-sm-value">' + daysWorked + '</span><span class="monthly-stat-sm-label">Tage</span></div>';
        html += '<div class="monthly-stat-sm"><span class="monthly-stat-sm-value">' + totalHours.toFixed(1) + '</span><span class="monthly-stat-sm-label">Stunden</span></div>';
        html += '<div class="monthly-stat-sm"><span class="monthly-stat-sm-value">' + _formatCurrency(brutto) + '</span><span class="monthly-stat-sm-label">Brutto</span></div>';
        html += '<div class="monthly-stat-sm"><span class="monthly-stat-sm-value">' + (nettoResult.available ? _formatCurrency(nettoResult.netto) : 'N/A') + '</span><span class="monthly-stat-sm-label">Netto</span></div>';
        html += '</div>';

        // Provision and tip line items
        if (provisions > 0 || tips > 0) {
          html += '<div class="monthly-job-extras">';
          if (provisions > 0) {
            html += '<span class="monthly-extra-item">Provision: ' + _formatCurrency(provisions) + '</span>';
          }
          if (tips > 0) {
            html += '<span class="monthly-extra-item">Trinkgeld: ' + _formatCurrency(tips) + '</span>';
          }
          html += '</div>';
        }

        // Vacation remaining indicator (Req 10.3)
        if (job.vacationEntitlement !== null && job.vacationEntitlement !== undefined && job.vacationEntitlement > 0) {
          var allWorkdays = AppState.getState().workdays;
          var yearPrefix = String(_selectedYear);
          var vacDaysTaken = 0;
          for (var v = 0; v < allWorkdays.length; v++) {
            if (allWorkdays[v].jobId === job.id &&
                allWorkdays[v].status === 'vacation' &&
                allWorkdays[v].date && allWorkdays[v].date.startsWith(yearPrefix)) {
              vacDaysTaken++;
            }
          }
          var vacRemaining = Math.max(0, job.vacationEntitlement - vacDaysTaken);
          html += '<div class="monthly-job-vacation-remaining">';
          html += '<span class="monthly-vacation-icon">🏖️</span>';
          html += '<span class="monthly-vacation-text">' + vacRemaining + ' / ' + job.vacationEntitlement + ' Urlaubstage verbleibend</span>';
          if (vacRemaining === 0) {
            html += '<span class="monthly-vacation-exhausted-badge">Aufgebraucht</span>';
          }
          html += '</div>';
        }

        html += limitHtml;
        html += '</div>';
      }

      container.innerHTML = html;
    }

    /**
     * Renders the day-by-day chronological list.
     */
    function _renderDayList() {
      var container = document.getElementById('monthly-day-list');
      if (!container) return;

      var entries = TimeTrackerModule.getEntriesForMonth(_selectedYear, _selectedMonth);

      if (!entries || entries.length === 0) {
        container.innerHTML = '<p class="monthly-empty-state">Keine Einträge für diesen Monat.</p>';
        return;
      }

      // Sort entries by date chronologically
      entries.sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });

      var html = '<div class="monthly-day-entries">';
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var job = _findJob(entry.jobId);
        var jobName = job ? job.employerName : 'Unbekannt';
        // German status labels per requirement 10.5
        var statusLabel;
        switch (entry.status) {
          case 'worked': statusLabel = 'gearbeitet'; break;
          case 'vacation': statusLabel = 'Urlaub'; break;
          case 'sick': statusLabel = 'krank'; break;
          case 'not_worked': statusLabel = 'nicht gearbeitet'; break;
          default: statusLabel = entry.status; break;
        }
        var hoursStr = entry.hours !== null && entry.hours !== undefined ? entry.hours.toFixed(2) + 'h' : '—';

        // Calculate brutto for this entry
        var entryBrutto = 0;
        if (entry.status === 'worked' && entry.hours && job) {
          var rate = (entry.hourlyRateOverride !== null && entry.hourlyRateOverride !== undefined)
            ? entry.hourlyRateOverride
            : (job.defaultHourlyRate || 0);
          entryBrutto = entry.hours * rate;
        }

        html += '<div class="monthly-day-entry" data-entry-id="' + entry.id + '">';
        html += '<span class="monthly-day-date">' + _escapeHtml(entry.date) + '</span>';
        html += '<span class="monthly-day-job">' + _escapeHtml(jobName) + '</span>';
        html += '<span class="monthly-day-status status-' + entry.status + '">' + statusLabel + '</span>';
        html += '<span class="monthly-day-hours">' + hoursStr + '</span>';
        html += '<span class="monthly-day-brutto">' + _formatCurrency(entryBrutto) + '</span>';
        html += '<button class="monthly-day-delete-btn" data-entry-id="' + entry.id + '" title="Eintrag löschen" aria-label="Eintrag löschen">✕</button>';
        html += '</div>';
      }
      html += '</div>';

      container.innerHTML = html;

      // Bind delete buttons
      var deleteButtons = container.querySelectorAll('.monthly-day-delete-btn');
      for (var d = 0; d < deleteButtons.length; d++) {
        deleteButtons[d].addEventListener('click', function (e) {
          var entryId = e.target.getAttribute('data-entry-id');
          if (entryId && confirm('Eintrag wirklich löschen? Das Gehalt wird entsprechend angepasst.')) {
            TimeTrackerModule.deleteEntry(entryId);
          }
        });
      }
    }

    /**
     * Full render of the monthly overview.
     */
    function _render() {
      _updateLabel();
      _renderAggregated();
      _renderJobSummaries();
      _renderDayList();
    }

    /**
     * Initializes the MonthlyOverviewModule — binds event handlers and renders.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Bind navigation buttons
      var prevBtn = document.getElementById('monthly-prev-btn');
      var nextBtn = document.getElementById('monthly-next-btn');

      if (prevBtn) {
        prevBtn.addEventListener('click', _prevMonth);
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', _nextMonth);
      }

      // Listen for events that should trigger a refresh
      EventBus.on('navigation:change', function (data) {
        if (data && (data.viewId === 'view-monthly' || data.view === 'view-monthly')) {
          _render();
        }
      });

      EventBus.on('workday:saved', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('workday:deleted', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('job:created', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('job:updated', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('job:deleted', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('income:updated', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('earnings:saved', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('earnings:deleted', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      EventBus.on('data:imported', function () {
        if (NavigationController.getActiveView() === 'view-monthly') {
          _render();
        }
      });

      // Reset to current month when user taps the "Monat" tab while already on it
      EventBus.on('monthly:reset_to_current', function () {
        _selectedYear = new Date().getFullYear();
        _selectedMonth = new Date().getMonth() + 1;
        _render();
      });

      // ── Calendar Toggle & Entry Form ──
      var calToggle = document.getElementById('monthly-calendar-toggle');
      var calContainer = document.getElementById('monthly-calendar-container');
      var calEntryForm = document.getElementById('monthly-calendar-entry-form');
      var calEntryFormEl = document.getElementById('monthly-calendar-entry-form-el');
      var calCancelBtn = document.getElementById('cal-entry-cancel-btn');

      if (calToggle && calContainer) {
        calToggle.addEventListener('click', function () {
          var visible = calContainer.style.display !== 'none';
          calContainer.style.display = visible ? 'none' : '';
          calToggle.classList.toggle('active', !visible);
          if (!visible) _renderCalendar();
        });
      }

      if (calCancelBtn && calEntryForm) {
        calCancelBtn.addEventListener('click', function () {
          calEntryForm.style.display = 'none';
        });
      }

      if (calEntryFormEl) {
        calEntryFormEl.addEventListener('submit', function (e) {
          e.preventDefault();
          _submitCalendarEntry();
        });

        // Show/hide hours based on status
        var statusSelect = document.getElementById('cal-entry-status');
        if (statusSelect) {
          statusSelect.addEventListener('change', function () {
            var hoursGroup = document.getElementById('cal-entry-hours-group');
            if (hoursGroup) {
              hoursGroup.style.display = (statusSelect.value === 'worked') ? '' : 'none';
            }
          });
        }
      }

      // Initial render
      _render();
    }

    // ── Calendar Helpers ──

    var _calendarSelectedDate = null;

    function _renderCalendar() {
      var grid = document.getElementById('monthly-calendar-grid');
      if (!grid) return;

      var year = _selectedYear;
      var month = _selectedMonth;
      var firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
      var daysInMonth = new Date(year, month, 0).getDate();
      // Adjust for Monday start (0=Mon, 6=Sun)
      var startOffset = (firstDay + 6) % 7;

      // Get entries for this month to mark days
      var entries = TimeTrackerModule.getEntriesForMonth(year, month);
      var entryDates = {};
      for (var i = 0; i < entries.length; i++) {
        var day = parseInt(entries[i].date.split('-')[2], 10);
        if (!entryDates[day]) entryDates[day] = [];
        entryDates[day].push(entries[i].status);
      }

      var today = new Date();
      var isCurrentMonth = (today.getFullYear() === year && today.getMonth() + 1 === month);
      var todayDay = today.getDate();

      var html = '<div class="cal-header-row">';
      var dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      for (var d = 0; d < 7; d++) {
        html += '<span class="cal-header-cell">' + dayNames[d] + '</span>';
      }
      html += '</div>';

      html += '<div class="cal-body">';
      var cellCount = 0;
      // Empty cells before first day
      for (var e = 0; e < startOffset; e++) {
        html += '<span class="cal-cell cal-empty"></span>';
        cellCount++;
      }
      // Day cells
      for (var day = 1; day <= daysInMonth; day++) {
        var classes = 'cal-cell';
        if (isCurrentMonth && day === todayDay) classes += ' cal-today';
        if (entryDates[day]) {
          classes += ' cal-has-entry';
          if (entryDates[day].indexOf('vacation') !== -1) classes += ' cal-vacation';
          else if (entryDates[day].indexOf('sick') !== -1) classes += ' cal-sick';
          else classes += ' cal-worked';
        }
        html += '<span class="' + classes + '" data-day="' + day + '">' + day + '</span>';
        cellCount++;
      }
      // Fill remaining cells
      while (cellCount % 7 !== 0) {
        html += '<span class="cal-cell cal-empty"></span>';
        cellCount++;
      }
      html += '</div>';

      grid.innerHTML = html;

      // Bind click on day cells
      var cells = grid.querySelectorAll('.cal-cell[data-day]');
      for (var c = 0; c < cells.length; c++) {
        cells[c].addEventListener('click', function () {
          var dayNum = parseInt(this.getAttribute('data-day'), 10);
          _onCalendarDayClick(dayNum);
        });
      }
    }

    function _onCalendarDayClick(day) {
      var dateStr = _selectedYear + '-' +
        String(_selectedMonth).padStart(2, '0') + '-' +
        String(day).padStart(2, '0');
      _calendarSelectedDate = dateStr;

      // Show entry form
      var formContainer = document.getElementById('monthly-calendar-entry-form');
      var title = document.getElementById('monthly-calendar-entry-title');
      var jobSelect = document.getElementById('cal-entry-job');
      var errorEl = document.getElementById('cal-entry-error');
      var hoursGroup = document.getElementById('cal-entry-hours-group');
      var statusSelect = document.getElementById('cal-entry-status');
      var provisionGroup = document.getElementById('cal-entry-provision-group');
      var tipGroup = document.getElementById('cal-entry-tip-group');

      if (title) title.textContent = 'Eintrag für ' + dateStr;
      if (errorEl) errorEl.textContent = '';
      if (hoursGroup) hoursGroup.style.display = '';
      if (statusSelect) statusSelect.value = 'worked';
      if (provisionGroup) provisionGroup.style.display = 'none';
      if (tipGroup) tipGroup.style.display = 'none';

      // Populate job select
      if (jobSelect) {
        var jobs = JobManager.getActiveJobs();
        var html = '';
        for (var i = 0; i < jobs.length; i++) {
          html += '<option value="' + jobs[i].id + '">' + jobs[i].employerName + ' (' + jobs[i].type + ')</option>';
        }
        jobSelect.innerHTML = html;

        // Show provision/tip fields based on selected job
        var updateExtras = function () {
          var selectedJobId = jobSelect.value;
          var selectedJob = null;
          for (var j = 0; j < jobs.length; j++) {
            if (jobs[j].id === selectedJobId) { selectedJob = jobs[j]; break; }
          }
          if (provisionGroup) provisionGroup.style.display = (selectedJob && selectedJob.hasProvision) ? '' : 'none';
          if (tipGroup) tipGroup.style.display = (selectedJob && selectedJob.hasTipTracking) ? '' : 'none';
        };
        updateExtras();
        jobSelect.addEventListener('change', updateExtras);
      }

      if (formContainer) formContainer.style.display = '';
    }

    function _submitCalendarEntry() {
      var jobSelect = document.getElementById('cal-entry-job');
      var statusSelect = document.getElementById('cal-entry-status');
      var hoursInput = document.getElementById('cal-entry-hours');
      var provisionInput = document.getElementById('cal-entry-provision');
      var tipInput = document.getElementById('cal-entry-tip');
      var errorEl = document.getElementById('cal-entry-error');

      if (!_calendarSelectedDate || !jobSelect) return;

      var jobId = jobSelect.value;
      var status = statusSelect ? statusSelect.value : 'worked';
      var hours = null;

      if (status === 'worked') {
        hours = parseFloat(hoursInput ? hoursInput.value : '');
        if (isNaN(hours) || hours < 0.25 || hours > 24) {
          if (errorEl) errorEl.textContent = 'Stunden müssen zwischen 0,25 und 24 liegen.';
          return;
        }
        // Validate 0.25 granularity
        if (Math.round(hours * 4) !== hours * 4) {
          if (errorEl) errorEl.textContent = 'Stunden müssen in 0,25-Schritten angegeben werden.';
          return;
        }
      }

      var result = TimeTrackerModule.createEntry({
        jobId: jobId,
        date: _calendarSelectedDate,
        status: status,
        hours: hours
      });

      if (result.success) {
        // Save provision if entered
        var provisionAmount = parseFloat(provisionInput ? provisionInput.value : '');
        if (!isNaN(provisionAmount) && provisionAmount > 0) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: _calendarSelectedDate,
            type: 'provision',
            amount: provisionAmount
          });
        }

        // Save tip if entered
        var tipAmount = parseFloat(tipInput ? tipInput.value : '');
        if (!isNaN(tipAmount) && tipAmount > 0) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: _calendarSelectedDate,
            type: 'tip',
            amount: tipAmount
          });
        }

        // Hide form, clear inputs, refresh
        var formContainer = document.getElementById('monthly-calendar-entry-form');
        if (formContainer) formContainer.style.display = 'none';
        if (hoursInput) hoursInput.value = '';
        if (provisionInput) provisionInput.value = '';
        if (tipInput) tipInput.value = '';
        _renderCalendar();
        _render();
      } else {
        if (errorEl) errorEl.textContent = result.error || 'Fehler beim Speichern.';
      }
    }

    /**
     * Public render method — renders the monthly overview for a given year/month.
     * @param {number} year
     * @param {number} month - 1-12
     */
    function render(year, month) {
      if (typeof year === 'number' && year > 0) _selectedYear = year;
      if (typeof month === 'number' && month >= 1 && month <= 12) _selectedMonth = month;
      _render();
    }

    /**
     * Public navigateMonth method — moves forward or backward by one month.
     * @param {number} direction - -1 for previous, 1 for next
     */
    function navigateMonth(direction) {
      if (direction === -1) {
        _prevMonth();
      } else if (direction === 1) {
        _nextMonth();
      }
    }

    return {
      init: init,
      render: render,
      navigateMonth: navigateMonth
    };
  })();

  // ─── YearlyOverviewModule ────────────────────────────────────────────────────
  // Renders the yearly overview view with per-job summaries, aggregated totals,
  // provision/trinkgeld totals, vacation/sick counts, and limit utilization.
  // Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
  const YearlyOverviewModule = (function () {
    let _initialized = false;
    let _selectedYear = new Date().getFullYear();

    // ── Helpers ──

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Formats a number as currency string with € symbol.
     * @param {number} val
     * @returns {string}
     */
    function _formatCurrency(val) {
      return (val || 0).toFixed(2) + ' €';
    }

    /**
     * Returns workday entries for a given job and year using TimeTrackerModule.
     * @param {string} jobId
     * @param {number} year
     * @returns {object[]}
     */
    function _getWorkdaysForYear(jobId, year) {
      var entries = [];
      for (var month = 1; month <= 12; month++) {
        var monthEntries = TimeTrackerModule.getEntriesForMonth(year, month, jobId);
        entries = entries.concat(monthEntries);
      }
      return entries;
    }

    /**
     * Counts total days worked, total hours, vacation days, and sick days for a job in a year.
     * @param {string} jobId
     * @param {number} year
     * @returns {{ daysWorked: number, totalHours: number, vacationDays: number, sickDays: number }}
     */
    function _getJobYearStats(jobId, year) {
      var entries = _getWorkdaysForYear(jobId, year);
      var daysWorked = 0;
      var totalHours = 0;
      var vacationDays = 0;
      var sickDays = 0;

      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.status === 'worked') {
          daysWorked++;
          if (entry.hours) totalHours += entry.hours;
        } else if (entry.status === 'vacation') {
          vacationDays++;
        } else if (entry.status === 'sick') {
          sickDays++;
        }
      }

      return {
        daysWorked: daysWorked,
        totalHours: Math.round(totalHours * 100) / 100,
        vacationDays: vacationDays,
        sickDays: sickDays
      };
    }

    /**
     * Gets limit utilization for a job based on its type.
     * @param {object} job
     * @param {number} year
     * @returns {object|null} LimitStatus or null if no applicable limit
     */
    function _getJobLimitStatus(job, year) {
      if (job.type === 'Minijob') {
        // For yearly view, show the current month's limit status
        var now = new Date();
        var month = (_selectedYear === now.getFullYear()) ? (now.getMonth() + 1) : 12;
        return LimitMonitor.checkMinijobLimit(job.id, year, month);
      }
      if (job.type === 'KFB') {
        return LimitMonitor.checkKFBDays(job.id, year);
      }
      return null;
    }

    /**
     * Renders the full yearly overview.
     */
    function _render() {
      var year = _selectedYear;
      var jobs = JobManager.getActiveJobs();

      // Update year label
      var yearLabel = document.getElementById('yearly-year-label');
      if (yearLabel) yearLabel.textContent = String(year);

      // Calculate aggregated totals via IncomeEngine
      var aggregated = IncomeEngine.getAggregatedYearly(year);

      // Calculate total hours, days, vacation, sick across all jobs
      var totalHours = 0;
      var totalDays = 0;
      var totalVacation = 0;
      var totalSick = 0;
      var totalProvision = 0;
      var totalTips = 0;

      for (var i = 0; i < jobs.length; i++) {
        var stats = _getJobYearStats(jobs[i].id, year);
        totalHours += stats.totalHours;
        totalDays += stats.daysWorked;
        totalVacation += stats.vacationDays;
        totalSick += stats.sickDays;
        totalProvision += IncomeEngine.getProvisionTotal(jobs[i].id, year);
        totalTips += IncomeEngine.getTipTotal(jobs[i].id, year);
      }

      // Update aggregate stats in DOM
      var elHours = document.getElementById('yearly-total-hours');
      var elDays = document.getElementById('yearly-total-days');
      var elBrutto = document.getElementById('yearly-total-brutto');
      var elNetto = document.getElementById('yearly-total-netto');
      var elProvision = document.getElementById('yearly-total-provision');
      var elTips = document.getElementById('yearly-total-tips');
      var elVacation = document.getElementById('yearly-total-vacation');
      var elSick = document.getElementById('yearly-total-sick');

      if (elHours) elHours.textContent = totalHours.toFixed(2);
      if (elDays) elDays.textContent = String(totalDays);
      if (elBrutto) elBrutto.textContent = _formatCurrency(aggregated.totalBrutto);
      if (elNetto) {
        elNetto.textContent = aggregated.nettoAvailable
          ? _formatCurrency(aggregated.totalNetto)
          : 'N/A';
      }
      if (elProvision) elProvision.textContent = _formatCurrency(totalProvision);
      if (elTips) elTips.textContent = _formatCurrency(totalTips);
      if (elVacation) elVacation.textContent = String(totalVacation);
      if (elSick) elSick.textContent = String(totalSick);

      // Render per-job summaries
      _renderJobSummaries(jobs, year);
    }

    /**
     * Renders per-job annual summary cards.
     * Shows empty state with zero values when no entries exist.
     * @param {object[]} jobs
     * @param {number} year
     */
    function _renderJobSummaries(jobs, year) {
      var container = document.getElementById('yearly-jobs-container');
      if (!container) return;

      // Empty state: no jobs configured
      if (jobs.length === 0) {
        container.innerHTML = '<p class="yearly-empty-state" id="yearly-no-jobs">Keine Jobs konfiguriert.</p>';
        return;
      }

      // Check if there are any entries at all for this year
      var hasAnyEntries = false;
      for (var j = 0; j < jobs.length; j++) {
        var yearEntries = _getWorkdaysForYear(jobs[j].id, year);
        if (yearEntries.length > 0) {
          hasAnyEntries = true;
          break;
        }
      }

      var html = '';

      // Show empty state message if no entries but jobs exist
      if (!hasAnyEntries) {
        html += '<p class="yearly-empty-state" id="yearly-no-jobs">Keine Einträge für ' + year + ' vorhanden.</p>';
      }

      for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        var stats = _getJobYearStats(job.id, year);
        var brutto = IncomeEngine.calculateYearlyBrutto(job.id, year);
        var nettoResult = IncomeEngine.calculateYearlyNetto(job.id, year);
        var provisions = IncomeEngine.getProvisionTotal(job.id, year);
        var tips = IncomeEngine.getTipTotal(job.id, year);
        var limitStatus = _getJobLimitStatus(job, year);

        html += '<div class="glass-surface layer-content yearly-job-card">';
        html += '<div class="yearly-job-header">';
        html += '<span class="yearly-job-name">' + _escapeHtml(job.employerName) + '</span>';
        html += '<span class="yearly-job-type-badge">' + _escapeHtml(job.type) + '</span>';
        html += '</div>';

        // Stats grid — German labels
        html += '<div class="yearly-job-stats">';
        html += '<div class="yearly-job-stat"><span class="yearly-job-stat-value">' + stats.totalHours.toFixed(1) + '</span><span class="yearly-job-stat-label">Stunden</span></div>';
        html += '<div class="yearly-job-stat"><span class="yearly-job-stat-value">' + _formatCurrency(brutto) + '</span><span class="yearly-job-stat-label">Brutto</span></div>';
        html += '<div class="yearly-job-stat"><span class="yearly-job-stat-value">';
        if (nettoResult.available) {
          html += _formatCurrency(nettoResult.netto);
        } else {
          html += 'N/A';
        }
        html += '</span><span class="yearly-job-stat-label">Netto</span></div>';
        html += '</div>';

        // Vacation & Sick — German labels
        html += '<div class="yearly-job-absence-row">';
        html += '<span class="yearly-job-absence-item">🏖️ Urlaub: ' + stats.vacationDays + ' Tage</span>';
        html += '<span class="yearly-job-absence-item">🤒 Krank: ' + stats.sickDays + ' Tage</span>';
        html += '</div>';

        // Provision & Tips — always shown
        html += '<div class="yearly-job-extras-row">';
        html += '<span class="yearly-job-extra-item">Provision: ' + _formatCurrency(provisions) + '</span>';
        html += '<span class="yearly-job-extra-item">Trinkgeld: ' + _formatCurrency(tips) + '</span>';
        html += '</div>';

        // Limit utilization
        if (limitStatus && limitStatus.status === 'available') {
          html += '<div class="yearly-job-limit">';
          html += '<div class="yearly-job-limit-header">';
          html += '<span class="yearly-job-limit-label">' + _getLimitLabel(limitStatus.limitType) + '</span>';
          html += '<span class="yearly-job-limit-value status-badge ' + limitStatus.displayWarningLevel + '">' + limitStatus.percentage + '%</span>';
          html += '</div>';
          html += '<div class="progress-bar"><div class="progress-bar-fill ' + limitStatus.displayWarningLevel + '" style="width:' + Math.min(limitStatus.percentage, 100) + '%"></div></div>';
          html += '<span class="yearly-job-limit-detail">' + limitStatus.current + ' / ' + limitStatus.limit + ' (verbleibend: ' + limitStatus.remaining + ')</span>';
          html += '</div>';
        } else if (limitStatus && limitStatus.status === 'unavailable') {
          html += '<div class="yearly-job-limit">';
          html += '<span class="yearly-job-limit-label">' + _getLimitLabel(limitStatus.limitType) + '</span>';
          html += '<span class="yearly-job-limit-na">Keine Daten verfügbar</span>';
          html += '</div>';
        }

        html += '</div>'; // close yearly-job-card
      }

      // Also show 26-week rule if applicable
      var weekRuleStatus = LimitMonitor.check26WeekRule(year);
      if (weekRuleStatus.status === 'available') {
        html += '<div class="glass-surface layer-content yearly-job-card yearly-26week-card">';
        html += '<div class="yearly-job-header">';
        html += '<span class="yearly-job-name">26-Wochen-Regel</span>';
        html += '<span class="yearly-job-type-badge">Kombiniert</span>';
        html += '</div>';
        html += '<div class="yearly-job-limit">';
        html += '<div class="yearly-job-limit-header">';
        html += '<span class="yearly-job-limit-label">Wochen gearbeitet (Werkstudent + Minijob/KFB)</span>';
        html += '<span class="yearly-job-limit-value status-badge ' + weekRuleStatus.displayWarningLevel + '">' + weekRuleStatus.percentage + '%</span>';
        html += '</div>';
        html += '<div class="progress-bar"><div class="progress-bar-fill ' + weekRuleStatus.displayWarningLevel + '" style="width:' + Math.min(weekRuleStatus.percentage, 100) + '%"></div></div>';
        html += '<span class="yearly-job-limit-detail">' + weekRuleStatus.current + ' / ' + weekRuleStatus.limit + ' Wochen (verbleibend: ' + weekRuleStatus.remaining + ')</span>';
        html += '</div>';
        html += '</div>';
      }

      container.innerHTML = html;
    }

    /**
     * Returns a German human-readable label for a limit type.
     * @param {string} limitType
     * @returns {string}
     */
    function _getLimitLabel(limitType) {
      switch (limitType) {
        case 'minijob_monthly': return 'Minijob Monatsgrenze (603 €)';
        case 'kfb_days': return 'KFB Tagesgrenze';
        case '26_week_rule': return '26-Wochen-Regel';
        default: return limitType;
      }
    }

    /**
     * Handles year navigation (previous).
     */
    function _onPrevYear() {
      _selectedYear--;
      _render();
    }

    /**
     * Handles year navigation (next).
     */
    function _onNextYear() {
      _selectedYear++;
      _render();
    }

    /**
     * Initializes the YearlyOverviewModule.
     * Binds navigation buttons and subscribes to EventBus events.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Default to current year
      _selectedYear = new Date().getFullYear();

      // Bind year navigation buttons
      var prevBtn = document.getElementById('yearly-prev-btn');
      var nextBtn = document.getElementById('yearly-next-btn');
      if (prevBtn) prevBtn.addEventListener('click', _onPrevYear);
      if (nextBtn) nextBtn.addEventListener('click', _onNextYear);

      // Re-render when yearly view becomes active
      EventBus.on('navigation:change', function (data) {
        if (data && (data.viewId === 'view-yearly' || data.view === 'view-yearly')) {
          _render();
        }
      });

      // Refresh on workday changes
      EventBus.on('workday:saved', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      EventBus.on('workday:deleted', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      // Refresh on job changes
      EventBus.on('job:created', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      EventBus.on('job:updated', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      EventBus.on('job:deleted', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      // Refresh on income/earnings changes
      EventBus.on('income:updated', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      EventBus.on('earnings:saved', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      EventBus.on('earnings:deleted', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      // Refresh on data import
      EventBus.on('data:imported', function () {
        if (NavigationController.getActiveView() === 'view-yearly') {
          _render();
        }
      });

      // Reset to current year when user taps the "Jahr" tab while already on it
      EventBus.on('yearly:reset_to_current', function () {
        _selectedYear = new Date().getFullYear();
        _render();
      });

      // Initial render
      _render();
    }

    /**
     * Public render method — renders the yearly overview for a given year.
     * @param {number} year - The year to render
     */
    function render(year) {
      if (typeof year === 'number' && year > 0) _selectedYear = year;
      _render();
    }

    /**
     * Public navigateYear method — moves forward or backward by one year.
     * @param {number} direction - -1 for previous, 1 for next
     */
    function navigateYear(direction) {
      if (direction === -1) {
        _onPrevYear();
      } else if (direction === 1) {
        _onNextYear();
      }
    }

    return {
      init: init,
      render: render,
      navigateYear: navigateYear
    };
  })();

  // ─── EntryViewModule ──────────────────────────────────────────────────────────
  // Manages the "Eintragen" tab: entry form, job selection, recent entries list.
  // Uses TimeTrackerModule.createEntry and EarningsExtraModule.addEarning for persistence.
  const EntryViewModule = (function () {
    let _initialized = false;

    /**
     * Formats a date string (YYYY-MM-DD) to German format (DD.MM.YYYY).
     * @param {string} dateStr
     * @returns {string}
     */
    function _formatDate(dateStr) {
      if (!dateStr) return '';
      var parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    /**
     * Populates the job select dropdown with active jobs.
     */
    function _populateJobSelect() {
      var jobSelect = document.getElementById('entry-job');
      if (!jobSelect) return;
      var jobs = JobManager.getActiveJobs();
      var html = '';
      for (var i = 0; i < jobs.length; i++) {
        html += '<option value="' + jobs[i].id + '">' + jobs[i].employerName + ' (' + jobs[i].type + ')</option>';
      }
      if (jobs.length === 0) {
        html = '<option value="">Kein Job vorhanden</option>';
      }
      jobSelect.innerHTML = html;
      _updateExtraFields();
    }

    /**
     * Shows/hides provision and tip fields based on selected job.
     */
    function _updateExtraFields() {
      var jobSelect = document.getElementById('entry-job');
      var provisionGroup = document.getElementById('entry-provision-group');
      var tipGroup = document.getElementById('entry-tip-group');
      if (!jobSelect) return;

      var selectedJobId = jobSelect.value;
      var jobs = JobManager.getActiveJobs();
      var selectedJob = null;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === selectedJobId) { selectedJob = jobs[i]; break; }
      }

      if (provisionGroup) provisionGroup.style.display = (selectedJob && selectedJob.hasProvision) ? '' : 'none';
      if (tipGroup) tipGroup.style.display = (selectedJob && selectedJob.hasTipTracking) ? '' : 'none';
    }

    /**
     * Handles form submission — creates a work entry and optional earnings.
     */
    function _handleSubmit(e) {
      e.preventDefault();
      var jobSelect = document.getElementById('entry-job');
      var dateInput = document.getElementById('entry-date');
      var statusSelect = document.getElementById('entry-status');
      var hoursInput = document.getElementById('entry-hours');
      var provisionInput = document.getElementById('entry-provision');
      var tipInput = document.getElementById('entry-tip');
      var errorEl = document.getElementById('entry-error');

      if (errorEl) errorEl.textContent = '';

      if (!jobSelect || !jobSelect.value) {
        if (errorEl) errorEl.textContent = 'Bitte wähle einen Job aus.';
        return;
      }

      var jobId = jobSelect.value;
      var date = dateInput ? dateInput.value : '';
      var status = statusSelect ? statusSelect.value : 'worked';
      var hours = null;

      if (!date) {
        if (errorEl) errorEl.textContent = 'Bitte wähle ein Datum aus.';
        return;
      }

      if (status === 'worked') {
        hours = parseFloat(hoursInput ? hoursInput.value : '');
        if (isNaN(hours) || hours < 0.25 || hours > 24) {
          if (errorEl) errorEl.textContent = 'Stunden müssen zwischen 0,25 und 24 liegen.';
          return;
        }
        if (Math.round(hours * 4) !== hours * 4) {
          if (errorEl) errorEl.textContent = 'Stunden müssen in 0,25-Schritten angegeben werden.';
          return;
        }
      }

      var result = TimeTrackerModule.createEntry({
        jobId: jobId,
        date: date,
        status: status,
        hours: hours
      });

      if (result.success) {
        // Save provision if entered
        var provisionAmount = parseFloat(provisionInput ? provisionInput.value : '');
        if (!isNaN(provisionAmount) && provisionAmount > 0) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: date,
            type: 'provision',
            amount: provisionAmount
          });
        }

        // Save tip if entered
        var tipAmount = parseFloat(tipInput ? tipInput.value : '');
        if (!isNaN(tipAmount) && tipAmount > 0) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: date,
            type: 'tip',
            amount: tipAmount
          });
        }

        // Clear form inputs (keep job and date for quick re-entry)
        if (hoursInput) hoursInput.value = '';
        if (provisionInput) provisionInput.value = '';
        if (tipInput) tipInput.value = '';
        if (statusSelect) statusSelect.value = 'worked';
        var hoursGroup = document.getElementById('entry-hours-group');
        if (hoursGroup) hoursGroup.style.display = '';

        showToast('Eintrag gespeichert ✓');
        _renderRecentEntries();
      } else {
        if (errorEl) errorEl.textContent = result.error || 'Fehler beim Speichern.';
      }
    }

    /**
     * Renders the recent entries list (last 10 entries across all jobs).
     */
    function _renderRecentEntries() {
      var listEl = document.getElementById('entry-recent-list');
      if (!listEl) return;

      var workdays = AppState.getState().workdays;
      if (!workdays || workdays.length === 0) {
        listEl.innerHTML = '<p class="entry-empty-state">Noch keine Einträge vorhanden.</p>';
        return;
      }

      // Sort by date descending, then by createdAt descending
      var sorted = workdays.slice().sort(function (a, b) {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      // Take last 10
      var recent = sorted.slice(0, 10);

      var jobs = JobManager.getActiveJobs();
      var jobMap = {};
      for (var j = 0; j < jobs.length; j++) {
        jobMap[jobs[j].id] = jobs[j];
      }

      var statusLabels = {
        worked: 'Gearbeitet',
        vacation: 'Urlaub',
        sick: 'Krank',
        not_worked: 'Nicht gearbeitet'
      };

      var html = '';
      for (var i = 0; i < recent.length; i++) {
        var entry = recent[i];
        var job = jobMap[entry.jobId];
        var jobName = job ? job.employerName : 'Unbekannt';
        var statusLabel = statusLabels[entry.status] || entry.status;
        var hoursText = (entry.status === 'worked' && entry.hours) ? entry.hours + ' Std.' : statusLabel;

        html += '<div class="entry-recent-item" data-entry-id="' + entry.id + '">';
        html += '<div class="entry-recent-info">';
        html += '<span class="entry-recent-date">' + _formatDate(entry.date) + '</span>';
        html += '<span class="entry-recent-meta">' + jobName + ' · ' + statusLabel + '</span>';
        html += '</div>';
        html += '<div class="entry-recent-actions">';
        html += '<span class="entry-recent-hours">' + hoursText + '</span>';
        html += '<button type="button" class="btn btn-danger entry-recent-delete-btn" data-entry-id="' + entry.id + '" aria-label="Eintrag löschen">🗑️</button>';
        html += '</div>';
        html += '</div>';
      }

      listEl.innerHTML = html;

      // Bind delete buttons
      var deleteBtns = listEl.querySelectorAll('.entry-recent-delete-btn');
      for (var d = 0; d < deleteBtns.length; d++) {
        deleteBtns[d].addEventListener('click', function () {
          var entryId = this.getAttribute('data-entry-id');
          if (entryId && confirm('Eintrag wirklich löschen?')) {
            TimeTrackerModule.deleteEntry(entryId);
            _renderRecentEntries();
          }
        });
      }
    }

    /**
     * Initializes the Entry View module.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Populate job select
      _populateJobSelect();

      // Set date to today
      var dateInput = document.getElementById('entry-date');
      if (dateInput) {
        var today = new Date();
        var yyyy = today.getFullYear();
        var mm = String(today.getMonth() + 1).padStart(2, '0');
        var dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = yyyy + '-' + mm + '-' + dd;
      }

      // Bind date navigation arrows
      var datePrevBtn = document.getElementById('entry-date-prev');
      var dateNextBtn = document.getElementById('entry-date-next');
      if (datePrevBtn && dateInput) {
        datePrevBtn.addEventListener('click', function () {
          var current = dateInput.value ? new Date(dateInput.value + 'T00:00:00') : new Date();
          current.setDate(current.getDate() - 1);
          dateInput.value = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0') + '-' + String(current.getDate()).padStart(2, '0');
        });
      }
      if (dateNextBtn && dateInput) {
        dateNextBtn.addEventListener('click', function () {
          var current = dateInput.value ? new Date(dateInput.value + 'T00:00:00') : new Date();
          current.setDate(current.getDate() + 1);
          dateInput.value = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0') + '-' + String(current.getDate()).padStart(2, '0');
        });
      }

      // Bind job select change to update extra fields
      var jobSelect = document.getElementById('entry-job');
      if (jobSelect) {
        jobSelect.addEventListener('change', _updateExtraFields);
      }

      // Bind status change to show/hide hours
      var statusSelect = document.getElementById('entry-status');
      if (statusSelect) {
        statusSelect.addEventListener('change', function () {
          var hoursGroup = document.getElementById('entry-hours-group');
          if (hoursGroup) {
            hoursGroup.style.display = (statusSelect.value === 'worked') ? '' : 'none';
          }
        });
      }

      // Bind form submit
      var form = document.getElementById('entry-form');
      if (form) {
        form.addEventListener('submit', _handleSubmit);
      }

      // Render recent entries
      _renderRecentEntries();

      // Subscribe to events for reactive updates
      EventBus.on('workday:saved', function () {
        if (NavigationController.getActiveView() === 'view-entry') {
          _renderRecentEntries();
        }
      });
      EventBus.on('workday:deleted', function () {
        if (NavigationController.getActiveView() === 'view-entry') {
          _renderRecentEntries();
        }
      });
      EventBus.on('job:created', function () {
        _populateJobSelect();
      });
      EventBus.on('job:updated', function () {
        _populateJobSelect();
      });
      EventBus.on('job:deleted', function () {
        _populateJobSelect();
      });
      EventBus.on('data:imported', function () {
        _populateJobSelect();
        _renderRecentEntries();
      });
    }

    return {
      init: init
    };
  })();

  // ─── GesamtübersichtModule ───────────────────────────────────────────────────
  // Displays aggregated monthly totals (hours, Brutto, Netto, Trinkgeld) at the
  // top of the Tracking Übersicht view. Subscribes to income:updated for reactive
  // updates within 2 seconds of any entry change.
  // Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
  const GesamtübersichtModule = (function () {
    let _initialized = false;

    /**
     * Formats a number as German currency string: "1.234,56 €"
     * @param {number} value
     * @returns {string}
     */
    function _formatCurrency(value) {
      if (value === null || value === undefined || isNaN(value)) {
        return '0,00 €';
      }
      // Round to 2 decimal places
      var rounded = Math.round(value * 100) / 100;
      // Format with German locale: thousands separator ".", decimal separator ","
      var parts = rounded.toFixed(2).split('.');
      var intPart = parts[0];
      var decPart = parts[1];
      // Add thousands separator
      var negative = intPart.charAt(0) === '-';
      if (negative) intPart = intPart.substring(1);
      var formatted = '';
      for (var i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
        if (count > 0 && count % 3 === 0) {
          formatted = '.' + formatted;
        }
        formatted = intPart.charAt(i) + formatted;
      }
      if (negative) formatted = '-' + formatted;
      return formatted + ',' + decPart + ' €';
    }

    /**
     * Formats hours as a plain number with German decimal separator.
     * @param {number} value
     * @returns {string}
     */
    function _formatHours(value) {
      if (value === null || value === undefined || isNaN(value)) {
        return '0';
      }
      var rounded = Math.round(value * 100) / 100;
      if (rounded === Math.floor(rounded)) {
        return String(Math.floor(rounded));
      }
      return String(rounded).replace('.', ',');
    }

    /**
     * Calculates current month aggregated totals and updates the DOM.
     * Also populates the Brutto/Netto breakdown dropdown and absence row.
     */
    function _update() {
      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth() + 1; // 1-based
      var day = now.getDate();

      // For the Gesamtübersicht, we aggregate per-job using each job's billing period.
      // If a job has billingDay and today > billingDay, that job is in the next month's period.
      var jobs = AppState.getState().jobs;
      var totalHours = 0;
      var totalBrutto = 0;
      var totalNetto = 0;
      var totalTips = 0;
      var totalProvision = 0;
      var totalVacationDays = 0;
      var totalSickDays = 0;
      var nettoAvailable = true;
      var perJob = [];

      for (var ji = 0; ji < jobs.length; ji++) {
        var job = jobs[ji];
        // Determine the billing month for this job
        var billingMonth = month;
        var billingYear = year;
        if (job.billingDay && day > job.billingDay) {
          billingMonth++;
          if (billingMonth > 12) { billingMonth = 1; billingYear++; }
        }
        var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, billingYear, billingMonth);
        var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, billingYear, billingMonth);
        var tips = IncomeEngine.getTipTotal(job.id, billingYear, billingMonth);
        var provisions = IncomeEngine.getProvisionTotal(job.id, billingYear, billingMonth);

        // Get hours from workdays in billing period
        var entries = TimeTrackerModule.getEntriesForMonth(billingYear, billingMonth, job.id);
        var jobHours = 0;
        var jobWorkDays = 0;
        var jobVacDays = 0;
        var jobSickDays = 0;
        for (var ei = 0; ei < entries.length; ei++) {
          if (entries[ei].status === 'worked' && entries[ei].hours) {
            jobHours += entries[ei].hours;
            jobWorkDays++;
          } else if (entries[ei].status === 'vacation') {
            jobVacDays++;
          } else if (entries[ei].status === 'sick') {
            jobSickDays++;
          }
        }

        totalHours += jobHours;
        totalBrutto += brutto;
        totalTips += tips;
        totalProvision += provisions;
        totalVacationDays += jobVacDays;
        totalSickDays += jobSickDays;

        if (nettoResult.available) {
          totalNetto += nettoResult.netto;
        } else {
          nettoAvailable = false;
        }

        perJob.push({
          jobId: job.id,
          employerName: job.employerName,
          type: job.type,
          brutto: brutto,
          netto: nettoResult.available ? nettoResult.netto : null,
          nettoAvailable: nettoResult.available,
          tips: tips,
          provisions: provisions
        });
      }

      var nettoCashflow = totalNetto + totalTips;
      var aggregated = {
        hours: totalHours,
        brutto: totalBrutto,
        netto: totalNetto,
        tips: totalTips,
        provision: totalProvision,
        vacationDays: totalVacationDays,
        sickDays: totalSickDays,
        totalBrutto: totalBrutto,
        totalNetto: totalNetto,
        totalTips: totalTips,
        nettoCashflow: nettoCashflow,
        nettoAvailable: nettoAvailable,
        perJob: perJob
      };

      // Update DOM elements
      var hoursEl = document.getElementById('dashboard-total-hours');
      var bruttoEl = document.getElementById('dashboard-total-brutto');
      var nettoEl = document.getElementById('dashboard-total-netto');
      var tipsEl = document.getElementById('dashboard-total-tips');

      if (hoursEl) {
        hoursEl.textContent = _formatHours(aggregated.hours);
      }
      if (bruttoEl) {
        bruttoEl.textContent = _formatCurrency(aggregated.brutto);
      }
      if (nettoEl) {
        // Netto cashflow includes tips added to netto
        nettoEl.textContent = _formatCurrency(aggregated.nettoCashflow);
      }
      if (tipsEl) {
        // Only show Trinkgeld if any job has tip tracking enabled
        var jobs = AppState.getState().jobs;
        var hasTipTracking = false;
        for (var t = 0; t < jobs.length; t++) {
          if (jobs[t].hasTipTracking) { hasTipTracking = true; break; }
        }
        if (hasTipTracking) {
          tipsEl.textContent = 'Trinkgeld: ' + _formatCurrency(aggregated.tips);
          tipsEl.style.display = '';
        } else {
          tipsEl.style.display = 'none';
        }
      }

      // ── Brutto/Netto Breakdown Dropdown ──
      _updateNettoBreakdown(aggregated, year, month);

      // ── Vacation & Sick Days ──
      _updateAbsenceRow(aggregated);
    }

    /**
     * Populates the Brutto/Netto breakdown dropdown with per-job deduction details.
     */
    function _updateNettoBreakdown(aggregated, year, month) {
      var breakdownEl = document.getElementById('dashboard-netto-breakdown');
      if (!breakdownEl) return;

      var perJob = aggregated.perJob;
      if (!perJob || perJob.length === 0 || aggregated.brutto === 0) {
        breakdownEl.innerHTML = '<p class="dashboard-details-empty">Füge Arbeitstage hinzu, um die Berechnung zu sehen.</p>';
        return;
      }

      var now = new Date();
      var day = now.getDate();
      var jobs = AppState.getState().jobs;

      var html = '';
      for (var i = 0; i < perJob.length; i++) {
        var pj = perJob[i];
        if (pj.brutto === 0 && (pj.netto === 0 || pj.netto === null)) continue;

        // Determine billing month for this job
        var jobObj = null;
        for (var jj = 0; jj < jobs.length; jj++) {
          if (jobs[jj].id === pj.jobId) { jobObj = jobs[jj]; break; }
        }
        var bMonth = month;
        var bYear = year;
        if (jobObj && jobObj.billingDay && day > jobObj.billingDay) {
          bMonth++;
          if (bMonth > 12) { bMonth = 1; bYear++; }
        }

        // Get deduction details for this job
        var nettoResult = IncomeEngine.calculateMonthlyNetto(pj.jobId, bYear, bMonth);

        html += '<div class="dashboard-netto-job">';
        html += '<div class="dashboard-netto-job-name">' + pj.employerName + ' (' + pj.type + ')</div>';
        html += '<div class="dashboard-netto-row"><span>Brutto</span><span>' + _formatCurrency(pj.brutto) + '</span></div>';

        if (nettoResult && nettoResult.deductions) {
          var d = nettoResult.deductions;
          if (d.pension > 0) {
            html += '<div class="dashboard-netto-row"><span>Rentenversicherung</span><span>−' + _formatCurrency(d.pension) + '</span></div>';
          }
          if (d.health > 0) {
            html += '<div class="dashboard-netto-row"><span>Krankenversicherung</span><span>−' + _formatCurrency(d.health) + '</span></div>';
          }
          if (d.care > 0) {
            html += '<div class="dashboard-netto-row"><span>Pflegeversicherung</span><span>−' + _formatCurrency(d.care) + '</span></div>';
          }
          if (d.unemployment > 0) {
            html += '<div class="dashboard-netto-row"><span>Arbeitslosenversicherung</span><span>−' + _formatCurrency(d.unemployment) + '</span></div>';
          }
          if (d.incomeTax > 0) {
            html += '<div class="dashboard-netto-row"><span>Lohnsteuer</span><span>−' + _formatCurrency(d.incomeTax) + '</span></div>';
          }
          if (d.soli > 0) {
            html += '<div class="dashboard-netto-row"><span>Solidaritätszuschlag</span><span>−' + _formatCurrency(d.soli) + '</span></div>';
          }
          if (d.kirchensteuer > 0) {
            html += '<div class="dashboard-netto-row"><span>Kirchensteuer</span><span>−' + _formatCurrency(d.kirchensteuer) + '</span></div>';
          }
        }

        if (pj.nettoAvailable) {
          html += '<div class="dashboard-netto-row total"><span>Netto</span><span>' + _formatCurrency(pj.netto) + '</span></div>';
        } else {
          html += '<div class="dashboard-netto-row total"><span>Netto</span><span>—</span></div>';
        }

        html += '</div>';
      }

      if (html === '') {
        breakdownEl.innerHTML = '<p class="dashboard-details-empty">Füge Arbeitstage hinzu, um die Berechnung zu sehen.</p>';
      } else {
        breakdownEl.innerHTML = html;
      }
    }

    /**
     * Shows/hides vacation and sick day counts based on job configuration.
     */
    function _updateAbsenceRow(aggregated) {
      var vacationItem = document.getElementById('dashboard-vacation-item');
      var sickItem = document.getElementById('dashboard-sick-item');
      var vacationValue = document.getElementById('dashboard-total-vacation');
      var sickValue = document.getElementById('dashboard-total-sick');

      // Check if any job has vacation or sick tracking enabled
      var jobs = AppState.getState().jobs;
      var hasVacation = false;
      var hasSick = false;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].vacationEntitlement && jobs[i].vacationEntitlement > 0) hasVacation = true;
        if (jobs[i].sickDayTracking) hasSick = true;
      }

      if (vacationItem) {
        vacationItem.style.display = hasVacation ? '' : 'none';
      }
      if (sickItem) {
        sickItem.style.display = hasSick ? '' : 'none';
      }
      if (vacationValue) {
        vacationValue.textContent = aggregated.vacationDays || 0;
      }
      if (sickValue) {
        sickValue.textContent = aggregated.sickDays || 0;
      }
    }

    /**
     * Initializes the module: performs initial calculation and subscribes to
     * income:updated event for reactive updates.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Initial render
      _update();

      // Subscribe to income:updated for reactive updates within 2 seconds
      EventBus.on('income:updated', function () {
        _update();
      });

      // Subscribe to earnings:saved/deleted for provision/tip updates
      EventBus.on('earnings:saved', function () {
        _update();
      });

      EventBus.on('earnings:deleted', function () {
        _update();
      });

      // Also update on data:imported (full reload scenario)
      EventBus.on('data:imported', function () {
        _update();
      });
    }

    return {
      init: init,
      // Exposed for testing
      _formatCurrency: _formatCurrency,
      _formatHours: _formatHours,
      _update: _update
    };
  })();

  // ─── JobCardRenderer ──────────────────────────────────────────────────────────
  // Renders type-specific job cards into the #job-cards-container element in the
  // daily view (Tracking Übersicht). Each active job gets a card with:
  // 1. Header: employer name + Job_Type badge
  // 2. Type-specific content (KFB ring, Minijob progress, Monatsgehalt, hours×rate)
  // 3. Inline entry row (rendered by TimeTrackerModule.renderInlineEntryRow)
  // 4. Limit/rules info box (rendered by LimitMonitorUI.renderForJob)
  // Subscribes to job:created, job:deleted, income:updated, limits:updated for reactivity.
  // Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 16.1, 16.2, 16.3, 16.4, 16.5
  const JobCardRenderer = (function () {
    let _initialized = false;

    /**
     * Formats a number as German currency string: "1.234,56 €"
     * @param {number} value
     * @returns {string}
     */
    function _formatCurrency(value) {
      if (value === null || value === undefined || isNaN(value)) {
        return '0,00 €';
      }
      var rounded = Math.round(value * 100) / 100;
      var parts = rounded.toFixed(2).split('.');
      var intPart = parts[0];
      var decPart = parts[1];
      var negative = intPart.charAt(0) === '-';
      if (negative) intPart = intPart.substring(1);
      var formatted = '';
      for (var i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
        if (count > 0 && count % 3 === 0) {
          formatted = '.' + formatted;
        }
        formatted = intPart.charAt(i) + formatted;
      }
      if (negative) formatted = '-' + formatted;
      return formatted + ',' + decPart + ' €';
    }

    /**
     * Formats hours as a plain number with German decimal separator.
     * @param {number} value
     * @returns {string}
     */
    function _formatHours(value) {
      if (value === null || value === undefined || isNaN(value)) {
        return '0';
      }
      var rounded = Math.round(value * 100) / 100;
      if (rounded === Math.floor(rounded)) {
        return String(Math.floor(rounded));
      }
      return String(rounded).replace('.', ',');
    }

    /**
     * Returns the current year and month (1-based).
     * @returns {{ year: number, month: number }}
     */
    function _getCurrentPeriod() {
      var now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }

    /**
     * Calculates total hours worked for a job in the current month.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month
     * @returns {number}
     */
    function _getMonthlyHours(jobId, year, month) {
      var entries = TimeTrackerModule.getEntriesForMonth(year, month, jobId);
      var total = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].status === 'worked' && entries[i].hours) {
          total += entries[i].hours;
        }
      }
      return total;
    }

    /**
     * Renders the card header with employer name and type badge.
     * @param {object} job
     * @returns {string} HTML string
     */
    function _renderCardHeader(job) {
      var avatarHtml = _renderJobAvatar(job);
      return '<div class="job-card-header">' +
        avatarHtml +
        '<span class="job-card-employer">' + _escapeHtml(job.employerName) + '</span>' +
        '<span class="job-card-type-badge">' + _escapeHtml(job.type) + '</span>' +
        '</div>';
    }

    /**
     * Renders a job avatar — logo from website or colored letter fallback.
     * @param {object} job
     * @returns {string} HTML string
     */
    function _renderJobAvatar(job) {
      if (job.website) {
        // Normalize domain for logo lookup
        var domain = job.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        var parts = domain.replace(/^www\./, '').split('.');
        if (parts.length > 2) {
          var last2 = parts.slice(-2).join('.');
          var known2 = ['co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'co.kr'];
          if (known2.indexOf(last2) !== -1 && parts.length > 3) {
            domain = parts.slice(-3).join('.');
          } else if (known2.indexOf(last2) === -1) {
            domain = parts.slice(-2).join('.');
          } else {
            domain = parts.join('.');
          }
        } else {
          domain = parts.join('.');
        }
        var logoUrl = 'https://icon.horse/icon/' + encodeURIComponent(domain);
        var fallbackLetter = (job.employerName || '?').charAt(0).toUpperCase();
        var bgColor = _getAvatarColor(job.employerName);
        return '<div class="job-card-avatar">' +
          '<img src="' + logoUrl + '" alt="" onerror="this.parentElement.innerHTML=\'<span class=&quot;job-card-avatar-letter&quot; style=&quot;background:' + bgColor + '&quot;>' + fallbackLetter + '</span>\'">' +
          '</div>';
      }
      // Fallback: colored letter avatar
      var letter = (job.employerName || '?').charAt(0).toUpperCase();
      var color = _getAvatarColor(job.employerName);
      return '<div class="job-card-avatar"><span class="job-card-avatar-letter" style="background:' + color + '">' + letter + '</span></div>';
    }

    /**
     * Generates a consistent color for a given string (employer name).
     * @param {string} str
     * @returns {string} CSS color
     */
    function _getAvatarColor(str) {
      var colors = ['#4ecca3', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];
      var hash = 0;
      for (var i = 0; i < (str || '').length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      return colors[Math.abs(hash) % colors.length];
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function _escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Renders KFB-specific card content: KFB Ring placeholder.
     * The actual ring is rendered by LimitMonitorUI.renderKFBRing into the container.
     * @param {object} job
     * @returns {string} HTML string
     */
    function _renderKFBContent(job) {
      var period = _getCurrentPeriod();
      var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, period.year, period.month);
      var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, period.year, period.month);

      var html = '<div class="job-card-content job-card-kfb">';
      html += '<div class="job-card-kfb-ring" id="job-card-kfb-ring-' + job.id + '"></div>';

      // Brutto/Netto display with deductions
      if (brutto > 0) {
        html += '<div class="job-card-earnings">';
        html += '<div class="job-card-stat"><span class="job-card-stat-label">Brutto</span><span class="job-card-stat-value">' + _formatCurrency(brutto) + '</span></div>';
        if (nettoResult && nettoResult.available) {
          html += '<div class="job-card-stat"><span class="job-card-stat-label">Netto</span><span class="job-card-stat-value accent">' + _formatCurrency(nettoResult.netto) + '</span></div>';
          if (nettoResult.deductions && nettoResult.deductions.total > 0) {
            html += '<div class="job-card-deductions">';
            html += '<div class="job-card-deductions-header">Abzüge (−' + _formatCurrency(nettoResult.deductions.total) + ')</div>';
            html += '<div class="job-card-deductions-list">';
            if (nettoResult.deductions.incomeTax > 0) {
              html += '<div class="job-card-deduction-item"><span>Lohnsteuer</span><span>−' + _formatCurrency(nettoResult.deductions.incomeTax) + '</span></div>';
            }
            if (nettoResult.deductions.soli > 0) {
              html += '<div class="job-card-deduction-item"><span>Solidaritätszuschlag</span><span>−' + _formatCurrency(nettoResult.deductions.soli) + '</span></div>';
            }
            if (nettoResult.deductions.kirchensteuer > 0) {
              html += '<div class="job-card-deduction-item"><span>Kirchensteuer</span><span>−' + _formatCurrency(nettoResult.deductions.kirchensteuer) + '</span></div>';
            }
            html += '</div>';
            html += '</div>';
          }
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders Minijob-specific card content: progress bar (brutto vs 603€ limit).
     * @param {object} job
     * @param {number} year
     * @param {number} month
     * @returns {string} HTML string
     */
    function _renderMinijobContent(job, year, month) {
      var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, year, month);
      var limit = RuleConfigEngine.getMinijobLimit(year);
      var percentage = limit > 0 ? Math.min((brutto / limit) * 100, 100) : 0;
      var warningLevel = percentage >= 95 ? 'critical' : (percentage >= 80 ? 'warning' : 'safe');
      var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, year, month);

      var html = '<div class="job-card-content job-card-minijob">';
      html += '<div class="job-card-progress-label">';
      html += '<span>' + _formatCurrency(brutto) + ' / ' + _formatCurrency(limit) + '</span>';
      html += '<span class="status-badge ' + warningLevel + '">' + Math.round(percentage) + '%</span>';
      html += '</div>';
      html += '<div class="job-card-progress-bar">';
      html += '<div class="job-card-progress-fill ' + warningLevel + '" style="width:' + percentage.toFixed(1) + '%"></div>';
      html += '</div>';

      // Netto with RV deduction breakdown
      if (brutto > 0 && nettoResult && nettoResult.available) {
        html += '<div class="job-card-earnings">';
        html += '<div class="job-card-stat"><span class="job-card-stat-label">Netto</span><span class="job-card-stat-value accent">' + _formatCurrency(nettoResult.netto) + '</span></div>';
        if (nettoResult.deductions && nettoResult.deductions.total > 0) {
          html += '<div class="job-card-deductions">';
          html += '<div class="job-card-deductions-header">Abzüge (−' + _formatCurrency(nettoResult.deductions.total) + ')</div>';
          html += '<div class="job-card-deductions-list">';
          if (nettoResult.deductions.pension > 0) {
            html += '<div class="job-card-deduction-item"><span>Rentenversicherung (3,6%)</span><span>−' + _formatCurrency(nettoResult.deductions.pension) + '</span></div>';
          }
          html += '</div>';
          html += '</div>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders Teilzeit/Vollzeit (fixed salary) card content: Monatsgehalt mode.
     * Shows fixed monthly salary, netto estimate, hours worked, overtime, provision/tip totals.
     * Requirements: 16.1, 16.2, 16.3, 16.4
     * @param {object} job
     * @param {number} year
     * @param {number} month
     * @returns {string} HTML string
     */
    function _renderFixedSalaryContent(job, year, month) {
      var salary = job.fixedMonthlySalary || 0;
      var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, year, month);
      var hoursWorked = _getMonthlyHours(job.id, year, month);

      // Calculate standard monthly hours for overtime
      var standardMonthlyHours = 0;
      if (job.standardHoursPerDay && job.standardDaysPerWeek) {
        standardMonthlyHours = job.standardHoursPerDay * job.standardDaysPerWeek * 4.33;
      }
      var overtime = standardMonthlyHours > 0 ? Math.max(0, hoursWorked - standardMonthlyHours) : 0;

      var html = '<div class="job-card-content job-card-fixed">';
      html += '<div class="job-card-primary-value">' + _formatCurrency(salary) + '</div>';

      // Netto estimate with deduction breakdown
      if (nettoResult && nettoResult.available) {
        html += '<div class="job-card-secondary-value">Netto: ' + _formatCurrency(nettoResult.netto) + '</div>';
        if (nettoResult.deductions && nettoResult.deductions.total > 0) {
          html += '<div class="job-card-deductions">';
          html += '<div class="job-card-deductions-header">Abzüge (−' + _formatCurrency(nettoResult.deductions.total) + ')</div>';
          html += '<div class="job-card-deductions-list">';
          if (nettoResult.deductions.incomeTax > 0) {
            html += '<div class="job-card-deduction-item"><span>Lohnsteuer</span><span>−' + _formatCurrency(nettoResult.deductions.incomeTax) + '</span></div>';
          }
          if (nettoResult.deductions.soli > 0) {
            html += '<div class="job-card-deduction-item"><span>Solidaritätszuschlag</span><span>−' + _formatCurrency(nettoResult.deductions.soli) + '</span></div>';
          }
          if (nettoResult.deductions.kirchensteuer > 0) {
            html += '<div class="job-card-deduction-item"><span>Kirchensteuer</span><span>−' + _formatCurrency(nettoResult.deductions.kirchensteuer) + '</span></div>';
          }
          if (nettoResult.deductions.pension > 0) {
            html += '<div class="job-card-deduction-item"><span>Rentenversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.pension) + '</span></div>';
          }
          if (nettoResult.deductions.health > 0) {
            html += '<div class="job-card-deduction-item"><span>Krankenversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.health) + '</span></div>';
          }
          if (nettoResult.deductions.care > 0) {
            html += '<div class="job-card-deduction-item"><span>Pflegeversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.care) + '</span></div>';
          }
          if (nettoResult.deductions.unemployment > 0) {
            html += '<div class="job-card-deduction-item"><span>Arbeitslosenversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.unemployment) + '</span></div>';
          }
          html += '</div>';
          html += '</div>';
        }
      } else {
        html += '<div class="job-card-secondary-value job-card-netto-unavailable">Netto nicht verfügbar</div>';
      }

      // Hours worked + overtime
      html += '<div class="job-card-stats">';
      html += '<span>' + _formatHours(hoursWorked) + ' Std. gearbeitet</span>';
      if (overtime > 0) {
        html += '<span class="job-card-overtime">+' + _formatHours(overtime) + ' Überstunden</span>';
      }
      html += '</div>';

      // Provision/tip totals if enabled
      if (job.hasProvision || job.hasTipTracking) {
        html += '<div class="job-card-extras">';
        if (job.hasProvision) {
          var provisionTotal = IncomeEngine.getProvisionTotal(job.id, year, month);
          html += '<span>Provision: ' + _formatCurrency(provisionTotal) + '</span>';
        }
        if (job.hasTipTracking) {
          var tipTotal = IncomeEngine.getTipTotal(job.id, year, month);
          html += '<span>Trinkgeld: ' + _formatCurrency(tipTotal) + '</span>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders Werkstudent or hourly Teilzeit/Vollzeit card content: hours × rate = brutto.
     * Also shows 26-week progress if combined with Minijob/KFB.
     * Requirements: 3.5, 16.5
     * @param {object} job
     * @param {number} year
     * @param {number} month
     * @returns {string} HTML string
     */
    function _renderHourlyContent(job, year, month) {
      var hoursWorked = _getMonthlyHours(job.id, year, month);
      var rate = job.defaultHourlyRate || 0;
      var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, year, month);

      var html = '<div class="job-card-content job-card-hourly">';
      html += '<div class="job-card-calculation">';
      html += '<span class="job-card-hours">' + _formatHours(hoursWorked) + ' Std.</span>';
      html += '<span class="job-card-multiply">×</span>';
      html += '<span class="job-card-rate">' + _formatCurrency(rate) + '/Std.</span>';
      html += '<span class="job-card-equals">=</span>';
      html += '<span class="job-card-brutto">' + _formatCurrency(brutto) + '</span>';
      html += '</div>';

      // Netto with deduction breakdown
      var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, year, month);
      if (nettoResult && nettoResult.available) {
        html += '<div class="job-card-secondary-value">Netto: ' + _formatCurrency(nettoResult.netto) + '</div>';
        if (nettoResult.deductions && nettoResult.deductions.total > 0) {
          html += '<div class="job-card-deductions">';
          html += '<div class="job-card-deductions-header">Abzüge (−' + _formatCurrency(nettoResult.deductions.total) + ')</div>';
          html += '<div class="job-card-deductions-list">';
          if (nettoResult.deductions.incomeTax > 0) {
            html += '<div class="job-card-deduction-item"><span>Lohnsteuer</span><span>−' + _formatCurrency(nettoResult.deductions.incomeTax) + '</span></div>';
          }
          if (nettoResult.deductions.soli > 0) {
            html += '<div class="job-card-deduction-item"><span>Solidaritätszuschlag</span><span>−' + _formatCurrency(nettoResult.deductions.soli) + '</span></div>';
          }
          if (nettoResult.deductions.kirchensteuer > 0) {
            html += '<div class="job-card-deduction-item"><span>Kirchensteuer</span><span>−' + _formatCurrency(nettoResult.deductions.kirchensteuer) + '</span></div>';
          }
          if (nettoResult.deductions.pension > 0) {
            html += '<div class="job-card-deduction-item"><span>Rentenversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.pension) + '</span></div>';
          }
          if (nettoResult.deductions.health > 0) {
            html += '<div class="job-card-deduction-item"><span>Krankenversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.health) + '</span></div>';
          }
          if (nettoResult.deductions.care > 0) {
            html += '<div class="job-card-deduction-item"><span>Pflegeversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.care) + '</span></div>';
          }
          if (nettoResult.deductions.unemployment > 0) {
            html += '<div class="job-card-deduction-item"><span>Arbeitslosenversicherung</span><span>−' + _formatCurrency(nettoResult.deductions.unemployment) + '</span></div>';
          }
          html += '</div>';
          html += '</div>';
        }
      } else if (nettoResult && !nettoResult.available) {
        html += '<div class="job-card-secondary-value job-card-netto-unavailable">Netto nicht verfügbar</div>';
      }

      // 26-week progress for Werkstudent if combined with Minijob/KFB
      if (job.type === 'Werkstudent') {
        var allJobs = JobManager.getActiveJobs();
        var hasCombined = false;
        var combinedTypes = [];
        for (var i = 0; i < allJobs.length; i++) {
          if (allJobs[i].id !== job.id && (allJobs[i].type === 'Minijob' || allJobs[i].type === 'KFB')) {
            hasCombined = true;
            combinedTypes.push(allJobs[i].type);
          }
        }
        if (hasCombined) {
          html += '<div class="job-card-26week" id="job-card-26week-' + job.id + '"></div>';
        }

        // Werkstudent rules info box
        html += '<div class="job-card-rules-info">';
        html += '<div class="job-card-rules-title">📋 Werkstudent-Regeln</div>';
        html += '<ul class="job-card-rules-list">';
        html += '<li>Max. 20 Std./Woche während der Vorlesungszeit</li>';
        html += '<li>Nur Rentenversicherung (9,3%) wird abgezogen</li>';
        if (hasCombined) {
          html += '<li class="rule-warning">⚠️ Kombination mit ' + combinedTypes.join(', ') + ': 26-Wochen-Regel beachten!</li>';
          html += '<li class="rule-warning">Bei Überschreitung: volle Sozialversicherungspflicht</li>';
        }
        html += '</ul>';
        html += '</div>';
      }

      // Provision/tip totals if enabled
      if (job.hasProvision || job.hasTipTracking) {
        html += '<div class="job-card-extras">';
        if (job.hasProvision) {
          var provisionTotal = IncomeEngine.getProvisionTotal(job.id, year, month);
          html += '<span>Provision: ' + _formatCurrency(provisionTotal) + '</span>';
        }
        if (job.hasTipTracking) {
          var tipTotal = IncomeEngine.getTipTotal(job.id, year, month);
          html += '<span>Trinkgeld: ' + _formatCurrency(tipTotal) + '</span>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    /**
     * Renders a single job card into the container.
     * @param {object} job
     * @param {HTMLElement} container
     */
    function _renderJobCard(job, container) {
      var period = _getCurrentPeriod();
      var year = period.year;
      var month = period.month;

      // Create card element
      var card = document.createElement('div');
      card.className = 'glass-surface job-card';
      card.id = 'job-card-' + job.id;
      card.setAttribute('data-job-id', job.id);
      card.setAttribute('data-job-type', job.type);

      // 1. Header
      var headerHtml = _renderCardHeader(job);

      // 2. Type-specific content
      var contentHtml = '';
      if (job.type === 'KFB') {
        contentHtml = _renderKFBContent(job);
      } else if (job.type === 'Minijob') {
        contentHtml = _renderMinijobContent(job, year, month);
      } else if ((job.type === 'Teilzeit' || job.type === 'Vollzeit') && job.salaryType === 'fixed') {
        contentHtml = _renderFixedSalaryContent(job, year, month);
      } else {
        // Werkstudent or hourly Teilzeit/Vollzeit
        contentHtml = _renderHourlyContent(job, year, month);
      }

      // 3. Limit/rules info box placeholder
      var limitsHtml = '<div class="job-card-limits" id="job-card-limits-' + job.id + '"></div>';

      card.innerHTML = headerHtml + contentHtml + limitsHtml;
      container.appendChild(card);

      // Render limit/rules info box via LimitMonitorUI
      var limitsContainer = document.getElementById('job-card-limits-' + job.id);
      if (limitsContainer) {
        LimitMonitorUI.renderForJob(job.id, limitsContainer);
      }

      // Render KFB ring if applicable
      if (job.type === 'KFB') {
        var ringContainer = document.getElementById('job-card-kfb-ring-' + job.id);
        if (ringContainer) {
          LimitMonitorUI.renderKFBRing(job.id, ringContainer);
        }
      }

      // Render 26-week progress for Werkstudent if container exists
      if (job.type === 'Werkstudent') {
        var weekContainer = document.getElementById('job-card-26week-' + job.id);
        if (weekContainer) {
          var weekStatus = LimitMonitor.check26WeekRule(year);
          if (weekStatus) {
            var current26 = weekStatus.current || 0;
            var limit26 = weekStatus.limit || 26;
            var pct26 = limit26 > 0 ? Math.min((current26 / limit26) * 100, 100) : 0;
            var level26 = pct26 >= 95 ? 'critical' : (pct26 >= 80 ? 'warning' : 'safe');
            weekContainer.innerHTML = '<div class="job-card-progress-label">' +
              '<span>26-Wochen-Regel: ' + current26 + ' / ' + limit26 + ' Wochen</span>' +
              '<span class="status-badge ' + level26 + '">' + Math.round(pct26) + '%</span>' +
              '</div>' +
              '<div class="job-card-progress-bar">' +
              '<div class="job-card-progress-fill ' + level26 + '" style="width:' + pct26.toFixed(1) + '%"></div>' +
              '</div>';
          }
        }
      }
    }

    /**
     * Renders all job cards. Clears existing cards and re-renders.
     */
    function render() {
      var container = document.getElementById('job-cards-container');
      var noJobsEl = document.getElementById('daily-no-jobs');
      if (!container) return;

      var jobs = JobManager.getActiveJobs();

      // Clear existing job cards (but keep the no-jobs element)
      var existingCards = container.querySelectorAll('.job-card');
      for (var i = 0; i < existingCards.length; i++) {
        existingCards[i].remove();
      }

      if (jobs.length === 0) {
        // Show no-jobs message
        if (noJobsEl) noJobsEl.style.display = '';
        return;
      }

      // Hide no-jobs message
      if (noJobsEl) noJobsEl.style.display = 'none';

      // Render each job card
      for (var j = 0; j < jobs.length; j++) {
        _renderJobCard(jobs[j], container);
      }
    }

    /**
     * Refreshes the content of all existing job cards without full re-render.
     * Used for income:updated and limits:updated events.
     */
    function refresh() {
      var container = document.getElementById('job-cards-container');
      if (!container) return;

      var jobs = JobManager.getActiveJobs();
      if (jobs.length === 0) return;

      // Full re-render for simplicity and correctness
      render();
    }

    /**
     * Initializes the module: renders cards and subscribes to events.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Initial render
      render();

      // Subscribe to job:created and job:deleted for adding/removing cards
      EventBus.on('job:created', function () {
        render();
      });

      EventBus.on('job:deleted', function () {
        render();
      });

      // Subscribe to income:updated and limits:updated for refreshing card content
      EventBus.on('income:updated', function () {
        refresh();
      });

      EventBus.on('limits:updated', function () {
        refresh();
      });

      // Also refresh on data:imported
      EventBus.on('data:imported', function () {
        _initialized = false;
        init();
      });
    }

    return {
      init: init,
      render: render,
      refresh: refresh
    };
  })();

  // ─── App Initialization ─────────────────────────────────────────────────────
  // Register onboarding view initialization with NavigationController
  NavigationController.registerView('view-onboarding', function () {
    OnboardingNavigation.init();
    OnboardingModule.init();
  });

  // Register daily view initialization with NavigationController (lazy-init)
  NavigationController.registerView('view-daily', function () {
    EarningsExtraModule.init();
    TimeTrackerModule.init();
    // IncomeEngine, LimitMonitor, LimitMonitorUI are initialized eagerly in DOMContentLoaded
    // Their init() functions are idempotent (guard with _initialized flag)
    IncomeEngine.init();
    LimitMonitor.init();
    LimitMonitorUI.init();
    GesamtübersichtModule.init();
    JobCardRenderer.init();
  });

  // Register settings view initialization with NavigationController (lazy-init)
  NavigationController.registerView('view-settings', function () {
    JobManager.initUI();
    ExportImportModule.init();
    PersonalDataModule.init();
  });

  // Register entry view initialization with NavigationController (lazy-init)
  NavigationController.registerView('view-entry', function () {
    EntryViewModule.init();
  });

  // Register monthly view initialization with NavigationController (lazy-init)
  NavigationController.registerView('view-monthly', function () {
    MonthlyOverviewModule.init();
  });

  // Register yearly view initialization with NavigationController (lazy-init)
  NavigationController.registerView('view-yearly', function () {
    YearlyOverviewModule.init();
  });

  // ─── YearChangePrompt (Req 13.5, 13.6) ──────────────────────────────────────
  // Displays year-change confirmation when a new calendar year begins.
  // On first launch of new calendar year: display prompt listing rule parameters.
  // If dismissed: continue with most recent confirmed config, re-display on next launch.
  // If confirmed: mark year as confirmed in RuleConfig.
  // Display in Einstellungen view when pending.
  const YearChangePrompt = (function () {
    let _pending = false;
    let _dismissedThisSession = false;
    let _pendingYear = null;

    /**
     * Renders the rule parameters for the given year in German.
     * @param {number} year
     */
    function _renderParams(year) {
      var promptEl = document.getElementById('year-change-prompt');
      if (!promptEl) return;

      // Set year label
      var yearLabel = document.getElementById('year-change-year');
      if (yearLabel) yearLabel.textContent = String(year);

      // Populate parameters in German
      var paramsEl = document.getElementById('year-change-params');
      if (paramsEl) {
        var config = RuleConfigEngine.getConfig(year);
        var html = '<ul class="year-change-params-list">';
        html += '<li><strong>Minijob-Grenze (monatlich):</strong> ' + config.minijobMonthlyLimit + ' €</li>';
        html += '<li><strong>KFB max. Tage/Jahr:</strong> ' + config.kfbMaxDaysPerYear + '</li>';
        html += '<li><strong>KFB max. aufeinanderfolgende Monate:</strong> ' + config.kfbMaxConsecutiveMonths + '</li>';
        html += '<li><strong>26-Wochen-Grenze:</strong> ' + config.twentySixWeekThreshold + ' Wochen</li>';
        html += '<li><strong>Rentenversicherung (AN-Anteil):</strong> ' + (config.socialInsuranceRates.pension * 100).toFixed(1) + ' %</li>';
        html += '<li><strong>Krankenversicherung (AN-Anteil):</strong> ' + (config.socialInsuranceRates.health * 100).toFixed(1) + ' %</li>';
        html += '<li><strong>Pflegeversicherung:</strong> ' + (config.socialInsuranceRates.care * 100).toFixed(2) + ' %</li>';
        html += '<li><strong>Arbeitslosenversicherung:</strong> ' + (config.socialInsuranceRates.unemployment * 100).toFixed(1) + ' %</li>';
        html += '<li><strong>Solidaritätszuschlag:</strong> ' + (config.solidaritaetszuschlag * 100).toFixed(1) + ' %</li>';
        html += '<li><strong>Kirchensteuer:</strong> ' + (config.kirchensteuerRate * 100).toFixed(0) + ' %</li>';
        html += '</ul>';
        paramsEl.innerHTML = html;
      }
    }

    /**
     * Shows the year-change prompt card in the Einstellungen view.
     * @param {number} year
     */
    function _show(year) {
      var promptEl = document.getElementById('year-change-prompt');
      if (!promptEl) return;
      _renderParams(year);
      promptEl.style.display = '';
    }

    /**
     * Hides the year-change prompt card.
     */
    function _hide() {
      var promptEl = document.getElementById('year-change-prompt');
      if (promptEl) promptEl.style.display = 'none';
    }

    /**
     * Checks whether the current year has a confirmed RuleConfig.
     * If not confirmed, sets the pending state and shows the prompt (unless dismissed this session).
     */
    function check() {
      var currentYear = new Date().getFullYear();
      _pendingYear = currentYear;

      // Check if current year config exists and is confirmed
      if (!RuleConfigEngine.hasConfigForYear(currentYear)) {
        _pending = true;
      } else {
        var config = RuleConfigEngine.getConfig(currentYear);
        _pending = config && !config.confirmedByUser;
      }

      // Show prompt if pending and not dismissed this session
      if (_pending && !_dismissedThisSession) {
        _show(currentYear);
      } else {
        _hide();
      }

      return _pending;
    }

    /**
     * Confirms the rule parameters for the given year.
     * Marks the year as confirmed in RuleConfigEngine and hides the prompt.
     * @param {number} year
     */
    function confirm(year) {
      var targetYear = year || _pendingYear || new Date().getFullYear();
      RuleConfigEngine.confirmYear(targetYear);
      _pending = false;
      _dismissedThisSession = false;
      _hide();
    }

    /**
     * Dismisses the prompt for this session.
     * The prompt will re-appear on next app launch since the year remains unconfirmed.
     */
    function dismiss() {
      _dismissedThisSession = true;
      _hide();
    }

    /**
     * Returns whether a year-change prompt is pending (year not confirmed).
     * @returns {boolean}
     */
    function isPending() {
      return _pending;
    }

    /**
     * Initializes the module: binds button handlers, listens for events, and runs initial check.
     */
    function init() {
      var confirmBtn = document.getElementById('year-change-confirm-btn');
      var dismissBtn = document.getElementById('year-change-dismiss-btn');

      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          confirm(_pendingYear);
        });
      }

      if (dismissBtn) {
        dismissBtn.addEventListener('click', function () {
          dismiss();
        });
      }

      // Listen for the year-change prompt event from AppState._checkYearChange()
      EventBus.on('yearchange:prompt_needed', function (data) {
        if (data && data.year) {
          _pendingYear = data.year;
          _pending = true;
          if (!_dismissedThisSession) {
            _show(data.year);
          }
        }
      });

      // Run initial check
      check();
    }

    return {
      init: init,
      check: check,
      confirm: confirm,
      dismiss: dismiss,
      isPending: isPending,
      // Backward compat — show is used by _wireGlobalEventBus
      show: _show,
      hide: _hide
    };
  })();

  // ─── Global EventBus Wiring (Req 17.1, 17.2, 17.3, 17.4, 17.5, 19.2) ──────
  // Central cross-module subscriptions that coordinate reactive updates.
  // Individual modules subscribe to events they need internally in their init().
  // These subscriptions handle cross-cutting concerns and ensure all reactive
  // updates propagate within 2 seconds of the triggering action.
  function _wireGlobalEventBus() {

    // ── workday:saved → IncomeEngine recalculate, LimitMonitor check,
    //    MonthlyOverview refresh, YearlyOverview refresh
    // (IncomeEngine, LimitMonitor, MonthlyOverview, YearlyOverview subscribe internally)

    // ── workday:deleted → same as workday:saved
    // (handled internally by each module)

    // ── job:created → NavigationController add card, LimitMonitor check
    EventBus.on('job:created', function () {
      // Refresh the daily view job cards if currently visible
      if (NavigationController.getActiveView() === 'view-daily') {
        JobCardRenderer.render();
      }
    });

    // ── job:updated → IncomeEngine recalculate, LimitMonitor check, all UI refresh
    EventBus.on('job:updated', function () {
      // Refresh daily view if visible
      if (NavigationController.getActiveView() === 'view-daily') {
        JobCardRenderer.refresh();
        GesamtübersichtModule.init();
      }
    });

    // ── job:deleted → all modules remove references
    EventBus.on('job:deleted', function () {
      // Refresh daily view if visible
      if (NavigationController.getActiveView() === 'view-daily') {
        JobCardRenderer.render();
        GesamtübersichtModule.init();
      }
    });

    // ── income:updated → Job Cards refresh, Gesamtübersicht refresh,
    //    MonthlyOverview, YearlyOverview
    // (JobCardRenderer, GesamtübersichtModule, MonthlyOverview, YearlyOverview
    //  subscribe internally)

    // ── limits:updated → LimitMonitorUI refresh, Job Cards
    // (LimitMonitorUI subscribes internally)

    // ── profile:updated → IncomeEngine Netto recalculation for all Teilzeit/Vollzeit
    // (IncomeEngine subscribes to profile:updated internally)
    EventBus.on('profile:updated', function () {
      // Also refresh UI if daily view is active
      if (NavigationController.getActiveView() === 'view-daily') {
        JobCardRenderer.refresh();
      }
    });

    // ── data:imported → full reload of all modules
    EventBus.on('data:imported', function () {
      // Theme may have changed after import
      var appState = AppState.getAppState();
      ThemeManager.setTheme(appState.themePreference || 'system');

      // Re-check year-change prompt after import
      YearChangePrompt.check();

      // Refresh current view
      var activeView = NavigationController.getActiveView();
      if (activeView === 'view-daily') {
        GesamtübersichtModule.init();
        JobCardRenderer.render();
      }
    });

    // ── earnings:saved/deleted → IncomeEngine recalculate
    // (IncomeEngine subscribes to earnings:saved/deleted internally)
  }

  // ─── Service Worker Registration (Req 19.2) ────────────────────────────────
  function _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(function (registration) {
        // Check for updates immediately on every page load
        registration.update();

        // When a new SW is found and installed, auto-reload the page
        registration.addEventListener('updatefound', function () {
          var newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                // New version activated — reload to get fresh assets
                window.location.reload();
              }
            });
          }
        });
      }).catch(function () {
        // Service worker registration failed — app continues without offline support
      });

      // Also reload when the controlling SW changes (e.g., skipWaiting was called)
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }

  // ─── App Entry Point (DOMContentLoaded) ────────────────────────────────────
  // Initialization order: EventBus → LocalStorageManager → RuleConfigEngine →
  // AppState → NavigationController → ThemeManager → JobManager →
  // TimeTrackerModule → EarningsExtraModule → IncomeEngine → LimitMonitor →
  // LimitMonitorUI → OnboardingModule → MonthlyOverviewModule →
  // YearlyOverviewModule → ExportImportModule → PersonalDataModule → YearChangePrompt
  //
  // EventBus is a static module (no init needed).
  // LocalStorageManager, RuleConfigEngine, and AppState are initialized via AppState.initApp().
  // UI modules use lazy initialization via NavigationController.registerView().
  // Data/calculation modules (IncomeEngine, LimitMonitor) are initialized eagerly
  // so they respond to events regardless of which view is active.
  document.addEventListener('DOMContentLoaded', function () {
    // ── Phase 1: Data Layer ──
    // EventBus is already available (static module, no init needed)
    // LocalStorageManager.init() + RuleConfigEngine.init() + AppState.init()
    AppState.initApp();

    // ── Phase 2: Navigation & Theme ──
    // JobManager must load jobs BEFORE NavigationController.init() because
    // the lazy-init for view-daily triggers JobCardRenderer which needs jobs loaded.
    JobManager.init();
    EarningsExtraModule.init();
    IncomeEngine.init();
    LimitMonitor.init();
    LimitMonitorUI.init();

    NavigationController.init();
    ThemeManager.init();

    // ── Header Theme Toggle ──
    var headerThemeToggle = document.getElementById('header-theme-toggle');
    if (headerThemeToggle) {
      var updateIcon = function() {
        var current = ThemeManager.getTheme();
        headerThemeToggle.textContent = (current === 'dark' || (current === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? '☀️' : '🌙';
      };
      headerThemeToggle.addEventListener('click', function() {
        var current = ThemeManager.getTheme();
        var next = (current === 'dark') ? 'light' : 'dark';
        ThemeManager.setTheme(next);
        updateIcon();
      });
      updateIcon();
    }

    // ── Header Rules Info Button ──
    var rulesInfoBtn = document.getElementById('header-rules-info-btn');
    var rulesInfoModal = document.getElementById('rules-info-modal');
    var rulesInfoCloseBtn = document.getElementById('rules-info-close-btn');
    if (rulesInfoBtn && rulesInfoModal) {
      rulesInfoBtn.addEventListener('click', function() {
        rulesInfoModal.classList.add('active');
        document.body.classList.add('modal-open');
      });
      if (rulesInfoCloseBtn) {
        rulesInfoCloseBtn.addEventListener('click', function() {
          rulesInfoModal.classList.remove('active');
          document.body.classList.remove('modal-open');
        });
      }
      rulesInfoModal.addEventListener('click', function(e) {
        if (e.target === rulesInfoModal) {
          rulesInfoModal.classList.remove('active');
          document.body.classList.remove('modal-open');
        }
      });
    }

    // ── Accent Color Picker ──
    var accentOptions = document.getElementById('accent-color-options');

    /**
     * Converts a hex color to RGB components.
     * @param {string} hex - e.g. "#4ecca3"
     * @returns {{ r: number, g: number, b: number }}
     */
    function _hexToRgb(hex) {
      hex = hex.replace('#', '');
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
      };
    }

    /**
     * Applies accent color and derived CSS variables for opacity variants.
     * @param {string} color - Hex color string
     */
    function _applyAccentColor(color) {
      var rgb = _hexToRgb(color);
      var rgbStr = rgb.r + ', ' + rgb.g + ', ' + rgb.b;
      document.documentElement.style.setProperty('--color-accent', color);
      document.documentElement.style.setProperty('--accent-rgb', rgbStr);
    }

    // Always apply saved accent color on load (even if settings DOM not found)
    var savedAccentOnLoad = AppState.get('accentColor') || '#4ecca3';
    _applyAccentColor(savedAccentOnLoad);

    if (accentOptions) {
      // Load saved accent color and apply immediately
      var savedAccent = AppState.get('accentColor') || '#4ecca3';
      _applyAccentColor(savedAccent);
      // Mark active button
      var accentBtns = accentOptions.querySelectorAll('.accent-color-btn');
      for (var ab = 0; ab < accentBtns.length; ab++) {
        if (accentBtns[ab].getAttribute('data-color') === savedAccent) {
          accentBtns[ab].classList.add('active');
        } else {
          accentBtns[ab].classList.remove('active');
        }
      }

      accentOptions.addEventListener('click', function(e) {
        var btn = e.target.closest('.accent-color-btn');
        if (!btn) return;
        var color = btn.getAttribute('data-color');
        if (!color) return;

        // Apply color and derived opacity variants
        _applyAccentColor(color);

        // Update active state
        var allBtns = accentOptions.querySelectorAll('.accent-color-btn');
        for (var i = 0; i < allBtns.length; i++) {
          allBtns[i].classList.remove('active');
        }
        btn.classList.add('active');

        // Persist
        AppState.set('accentColor', color);
      });
    }

    // ── PWA Install Skip Button ──
    var pwaSkipBtn = document.getElementById('pwa-install-skip-btn');
    if (pwaSkipBtn) {
      pwaSkipBtn.addEventListener('click', function () {
        AppState.set('pwaInstallSkipped', true);
        // Transition to onboarding
        NavigationController.switchTo('view-onboarding');
      });
    }

    // ── Logo Preview for Website Fields ──
    function _bindLogoPreview(inputId, previewId, imgId) {
      var input = document.getElementById(inputId);
      if (!input) return;
      var debounceTimer = null;
      input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          var val = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
          // Normalize domain
          var parts = val.replace(/^www\./, '').split('.');
          if (parts.length > 2) {
            var last2 = parts.slice(-2).join('.');
            var known2 = ['co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'co.kr'];
            if (known2.indexOf(last2) !== -1 && parts.length > 3) {
              val = parts.slice(-3).join('.');
            } else if (known2.indexOf(last2) !== -1) {
              val = parts.join('.');
            } else {
              val = parts.slice(-2).join('.');
            }
          } else {
            val = parts.join('.');
          }
          var preview = document.getElementById(previewId);
          var img = document.getElementById(imgId);
          if (!val || val.indexOf('.') === -1) {
            if (preview) preview.style.display = 'none';
            return;
          }
          if (img) {
            img.src = 'https://icon.horse/icon/' + encodeURIComponent(val);
            img.onload = function () { if (preview) preview.style.display = 'flex'; };
            img.onerror = function () { if (preview) preview.style.display = 'none'; };
          }
        }, 600);
      });
    }
    _bindLogoPreview('onb-employer-website', 'onb-logo-preview', 'onb-logo-img');
    _bindLogoPreview('settings-job-website', 'settings-logo-preview', 'settings-logo-img');

    // ── Phase 3: Wire cross-module EventBus subscriptions ──
    _wireGlobalEventBus();

    // ── Phase 4: App Entry Point ──
    // Check onboarding status and show appropriate view
    if (!AppState.isOnboardingComplete()) {
      // Show onboarding view (NavigationController.init() already handles this)
      // Onboarding modules are lazy-initialized when view-onboarding is shown
    } else {
      // Show last active view from AppState, or default to Tracking Übersicht
      var lastView = AppState.getActiveView();
      if (lastView && lastView !== 'view-onboarding') {
        NavigationController.switchTo(lastView);
      }
      // NavigationController.init() already shows the correct view from AppState
    }

    // ── Phase 6: Year-Change Prompt ──
    YearChangePrompt.init();
    if (AppState.isOnboardingComplete()) {
      YearChangePrompt.check();
    }

    // ── Phase 7: Utilities ──
    _initNumericValidation();

    // ── Phase 8: Service Worker Registration ──
    _registerServiceWorker();
  });

  // ─── Module Exports (Public API for debugging) ─────────────────────────────
  return {
    EventBus: EventBus,
    LocalStorageManager: LocalStorageManager,
    RuleConfigEngine: RuleConfigEngine,
    AppState: AppState,
    NavigationController: NavigationController,
    ThemeManager: ThemeManager,
    OnboardingNavigation: OnboardingNavigation,
    OnboardingModule: OnboardingModule,
    JobManager: JobManager,
    TimeTrackerModule: TimeTrackerModule,
    EarningsExtraModule: EarningsExtraModule,
    IncomeEngine: IncomeEngine,
    LimitMonitor: LimitMonitor,
    LimitMonitorUI: LimitMonitorUI,
    JobCardRenderer: JobCardRenderer,
    MonthlyOverviewModule: MonthlyOverviewModule,
    YearlyOverviewModule: YearlyOverviewModule,
    GesamtübersichtModule: GesamtübersichtModule,
    EntryViewModule: EntryViewModule,
    ExportImportModule: ExportImportModule,
    PersonalDataModule: PersonalDataModule,
    YearChangePrompt: YearChangePrompt,
    showToast: showToast
  };
})();
