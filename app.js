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
      EARNINGS_DELETED: 'earnings:deleted',
      // v2.0 module events
      PUNCH_STARTED: 'punch:started',
      PUNCH_ENDED: 'punch:ended',
      PUNCH_WARNING: 'punch:warning',
      GEO_REMINDER_TRIGGERED: 'geo:reminder_triggered',
      GEO_PERMISSION_DENIED: 'geo:permission_denied',
      RULE_WARNING_SHOWN: 'rule:warning_shown',
      RULE_WARNING_DISMISSED: 'rule:warning_dismissed',
      TAX_SLIDER_CHANGED: 'tax:slider_changed',
      SWIPE_DELETE_CONFIRMED: 'swipe:delete_confirmed',
      REFRESH_STARTED: 'refresh:started',
      REFRESH_COMPLETED: 'refresh:completed',
      REFRESH_FAILED: 'refresh:failed'
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
   * V3.1.1: Header is now in-flow (scrolls with content); the variable is
   * preserved as 0 so any legacy padding-top calc sites collapse cleanly.
   */
  function _setHeaderHeightVar() {
    document.documentElement.style.setProperty('--app-header-height', '0px');
  }

  /**
   * Update the --sub-nav-height CSS variable to match the actual rendered
   * height of the fixed sub-nav bar. Called on init, resize, and orientation
   * change so the tracking views' padding-top stays in sync with the bar.
   */
  function _setSubNavHeightVar() {
    var subNav = document.getElementById('tracking-sub-nav');
    if (!subNav) return;
    var h = subNav.offsetHeight;
    if (h > 0) {
      document.documentElement.style.setProperty('--sub-nav-height', h + 'px');
    }
  }

  /**
   * Shows a toast notification with the given message.
   * Used globally for save failures, import errors, and other transient messages.
   *
   * Modern stacked toasts: each call creates a new toast element inside
   * #toast-container. Multiple toasts stack vertically with a small gap.
   * Individual toasts auto-dismiss after `duration` ms with an exit animation.
   *
   * @param {string} message - The message to display
   * @param {number} [duration=2500] - Duration in ms before auto-hide
   * @param {string} [type] - 'success' | 'error' | 'info' (auto-detected if omitted)
   */
  function showToast(message, duration, type) {
    if (typeof message !== 'string') message = String(message == null ? '' : message);
    if (typeof duration !== 'number' || !isFinite(duration) || duration <= 0) {
      duration = 2500;
    }

    // Auto-detect type from common emoji prefixes / keywords if not provided
    if (!type) {
      if (/^✓|✅|gespeichert|erfolgreich|eingetragen|erfolgr/i.test(message)) {
        type = 'success';
      } else if (/^✕|❌|⚠️|fehlgeschlagen|fehler|verweigert|blockiert|nicht unterstützt/i.test(message)) {
        type = 'error';
      } else {
        type = 'info';
      }
    }

    // Map type to icon
    var icon = '';
    switch (type) {
      case 'success': icon = '✓'; break;
      case 'error':   icon = '✕'; break;
      default:        icon = 'ℹ'; break;
    }

    // Get or create the container
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }

    // Build the toast element
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.setAttribute('role', 'status');

    var iconEl = document.createElement('span');
    iconEl.className = 'toast__icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;

    var msgEl = document.createElement('span');
    msgEl.className = 'toast__message';
    msgEl.textContent = message;

    toast.appendChild(iconEl);
    toast.appendChild(msgEl);
    container.appendChild(toast);

    // Auto-dismiss with exit animation
    var dismissTimer = setTimeout(function () {
      toast.classList.add('toast--exit');
      var removeTimer = setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 280);
      toast._removeTimer = removeTimer;
    }, duration);
    toast._dismissTimer = dismissTimer;
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
  // Manages view switching (3-tab top header nav + sub-nav within Tracking).
  // Header tabs: Übersicht (view-daily), Eintragen (view-entry), Einstellungen (view-settings)
  // Sub-nav within Tracking: Übersicht (view-daily), Monat (view-monthly), Jahr (view-yearly)
  // Hides header tabs during onboarding. Emits navigation:change event via EventBus.
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
     * Updates the header tab bar to highlight the active tab.
     * For tracking sub-views (view-daily, view-monthly, view-yearly),
     * the "Übersicht" tab (data-view="view-daily") stays highlighted.
     * Also keeps any legacy bottom-nav .nav-tab elements in sync if present.
     * @param {string} viewId
     */
    function _updateNavBar(viewId) {
      // Determine which top tab should be active
      var activeTabView = viewId;
      if (TRACKING_VIEWS.indexOf(viewId) !== -1) {
        activeTabView = 'view-daily'; // Übersicht tab always highlighted for sub-views
      }

      var tabs = document.querySelectorAll('.header-tab, .nav-tab, .bottom-tab-btn');
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
     * Shows or hides the shared fixed sub-nav bar based on whether the
     * current view is a tracking view (Übersicht/Monat/Jahr). Toggles a
     * body class so the tracking views' padding-top can account for the
     * extra fixed bar height.
     * @param {string} viewId
     */
    function _updateSubNavVisibility(viewId) {
      var subNav = document.getElementById('tracking-sub-nav');
      if (!subNav) return;
      var TRACKING_VIEWS_LOCAL = ['view-daily', 'view-monthly', 'view-yearly'];
      if (TRACKING_VIEWS_LOCAL.indexOf(viewId) !== -1) {
        subNav.style.display = 'flex';
        document.body.classList.add('has-sub-nav');
        // Re-measure the bar height now that it's visible (offsetHeight is 0
        // while display:none, so we have to do this after toggling visibility).
        if (typeof _setSubNavHeightVar === 'function') {
          _setSubNavHeightVar();
        }
      } else {
        subNav.style.display = 'none';
        document.body.classList.remove('has-sub-nav');
      }
    }

    /**
     * Shows or hides the header tab bar (used during onboarding).
     * @param {boolean} visible - true to show, false to hide
     */
    function _setBottomNavVisible(visible) {
      var tabsBar = document.querySelector('.app-header__tabs');
      if (tabsBar) {
        tabsBar.style.display = visible ? '' : 'none';
      }
      // Also hide legacy bottom-nav if present (defensive)
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
      var tabs = document.querySelectorAll('.header-tab, .nav-tab');
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
      _updateSubNavVisibility(viewId);

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
      _updateSubNavVisibility(subViewId);
      _updateNavBar(subViewId);

      // Persist to AppState
      AppState.set('activeView', subViewId);
      AppState.set('activeSubView', subViewId);

      // Emit navigation change event
      EventBus.emit('navigation:change', { viewId: subViewId, subView: subViewId });
    }

    function _bindNavTabs() {
      var tabs = document.querySelectorAll('.header-tab, .nav-tab, .bottom-tab-btn');
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
     * No-op stub kept to avoid breakage — carousel-nav was removed in v3.1.0.
     */
    function _bindCarouselNav() {
      // Carousel nav removed in v3.1.0 (home-screen simplified).
    }

    function _triggerMicroHaptic() {
      if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.micro) {
        HapticFeedbackService.micro();
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

      // Bind carousel navigation buttons
      _bindCarouselNav();

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
          _updateSubNavVisibility('view-pwa-install');
          EventBus.emit('navigation:change', { viewId: 'view-pwa-install' });
        } else {
          // Show onboarding directly (already standalone or not iOS Safari)
          _activeView = 'view-onboarding';
          _activeSubView = 'view-daily';
          _showView('view-onboarding');
          _updateNavBar('');
          _updateSubNavVisibility('view-onboarding');
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
      _updateSubNavVisibility(targetView);

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
      var dailyRadio = document.querySelector('input[name="onb-salary-type"][value="daily"]');
      var hourlyGroup = document.getElementById('onb-hourly-rate-group');
      var dailyGroup = document.getElementById('onb-daily-rate-group');
      if (!hourlyRadio || !hourlyGroup) return;

      var radios = document.querySelectorAll('input[name="onb-salary-type"]');
      for (var i = 0; i < radios.length; i++) {
        radios[i].addEventListener('change', function () {
          hourlyGroup.style.display = hourlyRadio.checked ? '' : 'none';
          if (dailyGroup) dailyGroup.style.display = (dailyRadio && dailyRadio.checked) ? '' : 'none';
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
    const VALID_SALARY_TYPES = ['hourly', 'fixed', 'daily'];

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
        errors.push('Bitte eine gültige Gehaltsart auswählen (hourly, fixed, daily).');
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
     * Internal: sync GeoReminderService with a job's geo-reminder configuration.
     * If hasGeoReminder is true and coords are valid, set the location.
     * Otherwise, remove any existing reminder.
     * @param {object} job
     */
    function _syncGeoReminder(job) {
      if (typeof GeoReminderService === 'undefined') return;
      if (job.hasGeoReminder && typeof job.geoLat === 'number' && typeof job.geoLng === 'number') {
        GeoReminderService.setLocation(job.id, job.geoLat, job.geoLng, job.geoAddress || '');
      } else {
        GeoReminderService.removeLocation(job.id);
      }
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
        defaultDailyRate: jobData.salaryType === 'daily' && jobData.defaultDailyRate ? Number(jobData.defaultDailyRate) : null,
        standardHoursPerDay: jobData.standardHoursPerDay != null ? Number(jobData.standardHoursPerDay) : null,
        standardDaysPerWeek: jobData.standardDaysPerWeek != null ? Number(jobData.standardDaysPerWeek) : null,
        hasProvision: !!jobData.hasProvision,
        hasTipTracking: !!jobData.hasTipTracking,
        vacationEntitlement: jobData.vacationEntitlement != null ? Number(jobData.vacationEntitlement) : null,
        billingDay: jobData.billingDay != null ? Number(jobData.billingDay) : null,
        sickDayTracking: !!jobData.sickDayTracking,
        hasGeoReminder: !!jobData.hasGeoReminder,
        geoLat: (jobData.hasGeoReminder && typeof jobData.geoLat === 'number') ? jobData.geoLat : null,
        geoLng: (jobData.hasGeoReminder && typeof jobData.geoLng === 'number') ? jobData.geoLng : null,
        geoAddress: jobData.geoAddress || '',
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

      // Sync GeoReminderService with this job's reminder
      _syncGeoReminder(job);

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
      if (updates.defaultDailyRate !== undefined) updatedJob.defaultDailyRate = updates.defaultDailyRate != null ? Number(updates.defaultDailyRate) : null;
      if (updates.standardHoursPerDay !== undefined) updatedJob.standardHoursPerDay = updates.standardHoursPerDay != null ? Number(updates.standardHoursPerDay) : null;
      if (updates.standardDaysPerWeek !== undefined) updatedJob.standardDaysPerWeek = updates.standardDaysPerWeek != null ? Number(updates.standardDaysPerWeek) : null;
      if (updates.hasProvision !== undefined) updatedJob.hasProvision = !!updates.hasProvision;
      if (updates.hasTipTracking !== undefined) updatedJob.hasTipTracking = !!updates.hasTipTracking;
      if (updates.vacationEntitlement !== undefined) updatedJob.vacationEntitlement = updates.vacationEntitlement != null ? Number(updates.vacationEntitlement) : null;
      if (updates.billingDay !== undefined) updatedJob.billingDay = updates.billingDay != null ? Number(updates.billingDay) : null;
      if (updates.sickDayTracking !== undefined) updatedJob.sickDayTracking = !!updates.sickDayTracking;
      if (updates.hasGeoReminder !== undefined) updatedJob.hasGeoReminder = !!updates.hasGeoReminder;
      if (updates.geoLat !== undefined) updatedJob.geoLat = (typeof updates.geoLat === 'number') ? updates.geoLat : null;
      if (updates.geoLng !== undefined) updatedJob.geoLng = (typeof updates.geoLng === 'number') ? updates.geoLng : null;
      if (updates.geoAddress !== undefined) updatedJob.geoAddress = updates.geoAddress || '';
      updatedJob.updatedAt = now;

      _jobs[index] = updatedJob;
      var result = _persist();
      if (!result.success) {
        // Revert on failure
        _jobs[index] = existing;
        return { success: false, error: result.error || 'persist_failed' };
      }

      // Sync GeoReminderService with the updated job's reminder
      _syncGeoReminder(updatedJob);

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

      // Reset geo-reminder fields
      var geoToggle = document.getElementById('settings-job-geo-reminder');
      var geoFields = document.getElementById('settings-job-geo-fields');
      var geoLatField = document.getElementById('settings-job-geo-lat');
      var geoLngField = document.getElementById('settings-job-geo-lng');
      var geoStatusEl = document.getElementById('settings-job-geo-status');
      var geoAddressField = document.getElementById('settings-job-geo-address');
      if (geoToggle) geoToggle.checked = false;
      if (geoFields) geoFields.style.display = 'none';
      if (geoLatField) geoLatField.value = '';
      if (geoLngField) geoLngField.value = '';
      if (geoAddressField) geoAddressField.value = '';
      if (geoStatusEl) geoStatusEl.textContent = '';

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
      var dailyGroup = document.getElementById('settings-daily-rate-group');
      var selected = _getSelectedSalaryType();
      if (hourlyGroup) hourlyGroup.style.display = (selected === 'hourly') ? '' : 'none';
      if (fixedGroup) fixedGroup.style.display = (selected === 'fixed') ? '' : 'none';
      if (dailyGroup) dailyGroup.style.display = (selected === 'daily') ? '' : 'none';
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
      var dailyRateField = document.getElementById('settings-job-daily-rate');
      if (dailyRateField) dailyRateField.value = job.defaultDailyRate != null ? job.defaultDailyRate : '';

      // Optional fields
      document.getElementById('settings-job-vacation').value = job.vacationEntitlement != null ? job.vacationEntitlement : '';
      var billingDayField = document.getElementById('settings-job-billing-day');
      if (billingDayField) billingDayField.value = job.billingDay != null ? job.billingDay : '';
      document.getElementById('settings-job-provision').checked = !!job.hasProvision;
      document.getElementById('settings-job-tips').checked = !!job.hasTipTracking;
      document.getElementById('settings-job-sick').checked = !!job.sickDayTracking;

      // Geo-Reminder fields
      var geoToggle = document.getElementById('settings-job-geo-reminder');
      var geoFields = document.getElementById('settings-job-geo-fields');
      var geoLatField = document.getElementById('settings-job-geo-lat');
      var geoLngField = document.getElementById('settings-job-geo-lng');
      var geoStatusEl = document.getElementById('settings-job-geo-status');
      var geoAddressInput = document.getElementById('settings-job-geo-address');
      if (geoToggle) geoToggle.checked = !!job.hasGeoReminder;
      if (geoFields) geoFields.style.display = job.hasGeoReminder ? '' : 'none';
      if (geoLatField) geoLatField.value = (job.geoLat != null) ? String(job.geoLat) : '';
      if (geoLngField) geoLngField.value = (job.geoLng != null) ? String(job.geoLng) : '';
      if (geoAddressInput) geoAddressInput.value = job.geoAddress || '';
      if (geoStatusEl) {
        if (job.hasGeoReminder && job.geoLat != null && job.geoLng != null) {
          geoStatusEl.textContent = '✓ Standort gesetzt';
        } else if (job.hasGeoReminder) {
          geoStatusEl.textContent = '';
        } else {
          geoStatusEl.textContent = '';
        }
      }

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
      var dailyRate = salaryType === 'daily' ? (function() { var dr = document.getElementById('settings-job-daily-rate'); return dr && dr.value ? parseFloat(dr.value) : null; })() : null;
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
        defaultDailyRate: dailyRate,
        standardHoursPerDay: null,
        standardDaysPerWeek: null,
        hasProvision: document.getElementById('settings-job-provision').checked,
        hasTipTracking: document.getElementById('settings-job-tips').checked,
        vacationEntitlement: vacation,
        billingDay: (function() { var bd = document.getElementById('settings-job-billing-day'); return bd && bd.value ? parseInt(bd.value, 10) : null; })(),
        sickDayTracking: document.getElementById('settings-job-sick').checked,
        hasGeoReminder: (function() { var g = document.getElementById('settings-job-geo-reminder'); return g ? !!g.checked : false; })(),
        geoLat: (function() { var g = document.getElementById('settings-job-geo-lat'); return (g && g.value) ? parseFloat(g.value) : null; })(),
        geoLng: (function() { var g = document.getElementById('settings-job-geo-lng'); return (g && g.value) ? parseFloat(g.value) : null; })(),
        geoAddress: (function() { var g = document.getElementById('settings-job-geo-address'); return (g && g.value) ? g.value.trim() : ''; })()
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
     * Binds the geo-reminder toggle, address input, and locate button.
     */
    function _bindGeoReminderControls() {
      var geoToggle = document.getElementById('settings-job-geo-reminder');
      var geoFields = document.getElementById('settings-job-geo-fields');
      var geoAddressInput = document.getElementById('settings-job-geo-address');
      var geoLocateBtn = document.getElementById('settings-job-geo-locate');
      var geoStatusEl = document.getElementById('settings-job-geo-status');

      if (geoToggle && !geoToggle._bound) {
        geoToggle._bound = true;
        geoToggle.addEventListener('change', function () {
          if (geoFields) geoFields.style.display = geoToggle.checked ? '' : 'none';

          if (geoToggle.checked) {
            // Default hint when enabled but no coords yet
            if (geoStatusEl) geoStatusEl.textContent = '';

            // Request notification permission proactively
            if ('Notification' in window) {
              if (Notification.permission === 'default') {
                try {
                  var p = Notification.requestPermission();
                  if (p && typeof p.then === 'function') {
                    p.then(function (permission) {
                      if (permission !== 'granted') {
                        if (geoStatusEl) geoStatusEl.textContent = '⚠️ Benachrichtigungen blockiert';
                      }
                    });
                  }
                } catch (e) {
                  Notification.requestPermission(function () {});
                }
              } else if (Notification.permission === 'denied') {
                if (geoStatusEl) geoStatusEl.textContent = '⚠️ Benachrichtigungen blockiert';
              }
            }
          } else {
            if (geoStatusEl) geoStatusEl.textContent = '';
          }
        });
      }

      // Address input: geocode on blur or Enter
      if (geoAddressInput && !geoAddressInput._bound) {
        geoAddressInput._bound = true;
        geoAddressInput.addEventListener('blur', function () {
          var address = geoAddressInput.value.trim();
          if (address.length > 2) {
            _geocodeAddress(address, function (result) {
              if (result) {
                document.getElementById('settings-job-geo-lat').value = String(result.lat);
                document.getElementById('settings-job-geo-lng').value = String(result.lng);
                if (geoStatusEl) {
                  geoStatusEl.textContent = '✓ Standort gefunden: ' + _shortenAddress(result.display);
                  geoStatusEl.classList.remove('geo-status--error');
                  geoStatusEl.classList.add('geo-status--ok');
                }
              } else {
                if (geoStatusEl) {
                  geoStatusEl.textContent = '✗ Adresse nicht gefunden';
                  geoStatusEl.classList.remove('geo-status--ok');
                  geoStatusEl.classList.add('geo-status--error');
                }
              }
            });
          }
        });
        geoAddressInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            geoAddressInput.blur();
          }
        });
      }

      // Locate button: get current position, reverse geocode to address
      if (geoLocateBtn && !geoLocateBtn._bound) {
        geoLocateBtn._bound = true;
        geoLocateBtn.addEventListener('click', function () {
          if (geoStatusEl) geoStatusEl.textContent = 'Standort wird ermittelt…';
          if (typeof GeoReminderService === 'undefined' || !GeoReminderService.getCurrentPosition) {
            if (geoStatusEl) geoStatusEl.textContent = '✗ Geolocation nicht verfügbar';
            return;
          }
          GeoReminderService.getCurrentPosition(function (result) {
            if (result && typeof result.lat === 'number' && typeof result.lng === 'number') {
              var latField = document.getElementById('settings-job-geo-lat');
              var lngField = document.getElementById('settings-job-geo-lng');
              if (latField) latField.value = String(result.lat);
              if (lngField) lngField.value = String(result.lng);
              // Reverse geocode to show address
              _reverseGeocode(result.lat, result.lng, function (displayName) {
                if (geoAddressInput) geoAddressInput.value = displayName;
                if (geoStatusEl) {
                  geoStatusEl.textContent = '✓ Standort gefunden';
                  geoStatusEl.classList.remove('geo-status--error');
                  geoStatusEl.classList.add('geo-status--ok');
                }
              });
            } else {
              if (geoStatusEl) {
                geoStatusEl.textContent = '✗ Position nicht verfügbar';
                geoStatusEl.classList.remove('geo-status--ok');
                geoStatusEl.classList.add('geo-status--error');
              }
            }
          });
        });
      }
    }

    /**
     * Geocode an address string to lat/lng using Nominatim (OpenStreetMap).
     */
    function _geocodeAddress(address, callback) {
      var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
      fetch(url, { headers: { 'Accept-Language': 'de' } })
        .then(function (r) { return r.json(); })
        .then(function (results) {
          if (results && results.length > 0) {
            callback({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon), display: results[0].display_name });
          } else {
            callback(null);
          }
        })
        .catch(function () { callback(null); });
    }

    /**
     * Reverse geocode lat/lng to a display address using Nominatim.
     */
    function _reverseGeocode(lat, lng, callback) {
      var url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng;
      fetch(url, { headers: { 'Accept-Language': 'de' } })
        .then(function (r) { return r.json(); })
        .then(function (result) {
          if (result && result.display_name) {
            callback(result.display_name);
          } else {
            callback(lat.toFixed(4) + ', ' + lng.toFixed(4));
          }
        })
        .catch(function () { callback(lat.toFixed(4) + ', ' + lng.toFixed(4)); });
    }

    /**
     * Shorten a display address to first 2-3 parts for the status hint.
     */
    function _shortenAddress(display) {
      if (!display) return '';
      var parts = display.split(',');
      return parts.slice(0, 3).join(',').trim();
    }

    /**
     * Update the geo-status badge element's class and text.
     * @param {HTMLElement} el
     * @param {'active'|'inactive'|'error'} state
     * @param {string} text
     */
    function _setGeoStatusBadge(el, state, text) {
      if (!el) return;
      el.className = 'geo-status-badge geo-status-badge--' + state;
      el.textContent = text;
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

      // Bind geo-reminder toggle and "use current location" button
      _bindGeoReminderControls();

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
        _setError('error-krankenversicherung', 'Bitte eine Versicherungsart auswählen');
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
        defaultDailyRate: salaryType === 'daily' ? (function() { var dr = document.getElementById('onb-daily-rate'); return dr && dr.value ? parseFloat(dr.value) : null; })() : null,
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
        html += '<dt>Gehaltsart</dt><dd>' + (job.salaryType === 'hourly' ? 'Stundenlohn' : job.salaryType === 'daily' ? 'Tagessatz' : 'Festgehalt') + '</dd>';
        if (job.salaryType === 'hourly' && job.defaultHourlyRate !== null) {
          html += '<dt>Stundenlohn</dt><dd>' + job.defaultHourlyRate.toFixed(2) + ' €</dd>';
        }
        if (job.salaryType === 'daily' && job.defaultDailyRate !== null) {
          html += '<dt>Standard-Tagessatz</dt><dd>' + job.defaultDailyRate.toFixed(2) + ' €</dd>';
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
      // Show header tabs, enable nav tabs, and switch to daily view
      var tabsBar = document.querySelector('.app-header__tabs');
      if (tabsBar) tabsBar.style.display = '';
      var bottomNav = document.querySelector('.bottom-nav');
      if (bottomNav) bottomNav.style.display = '';
      var tabs = document.querySelectorAll('.header-tab, .nav-tab');
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
     * Also cleans up orphaned earnings (no matching workday entry).
     */
    function init() {
      var result = LocalStorageManager.load(STORAGE_KEY);
      if (result.success && Array.isArray(result.data)) {
        _earnings = result.data;
      } else {
        _earnings = [];
      }

      // Cleanup: remove orphaned earnings that have no matching workday
      _cleanupOrphanedEarnings();
    }

    /**
     * Removes earnings entries that have no corresponding workday entry
     * (same jobId + same date with status 'worked').
     */
    function _cleanupOrphanedEarnings() {
      if (_earnings.length === 0) return;
      var workdays = AppState.getState().workdays;
      var workdayMap = {};
      for (var i = 0; i < workdays.length; i++) {
        var key = workdays[i].jobId + '|' + workdays[i].date;
        workdayMap[key] = true;
      }
      var before = _earnings.length;
      _earnings = _earnings.filter(function (e) {
        var key = e.jobId + '|' + e.date;
        return workdayMap[key];
      });
      if (_earnings.length < before) {
        _persist();
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
     * @param {boolean} [includePending=false] - When true, also count entries
     *   with status === 'pending' (treated like 'worked'). Used by the
     *   "Projiziert" mode in Gesamtübersicht.
     * @returns {number}
     */
    function calculateMonthlyBrutto(jobId, year, month, includePending) {
      var job = _findJob(jobId);
      if (!job) return 0.00;

      var workdays = _getWorkdaysForMonth(jobId, year, month);
      var provisions = getProvisionTotal(jobId, year, month);
      var inclPending = includePending === true;

      var brutto = 0;

      if (job.salaryType === 'hourly') {
        // Sum (hours × applicable rate) for each worked day
        for (var i = 0; i < workdays.length; i++) {
          var entry = workdays[i];
          var counts = entry.status === 'worked' || (inclPending && entry.status === 'pending');
          if (counts && entry.hours) {
            var rate = (entry.hourlyRateOverride !== null && entry.hourlyRateOverride !== undefined)
              ? entry.hourlyRateOverride
              : job.defaultHourlyRate;
            brutto += entry.hours * rate;
          }
        }
      } else if (job.salaryType === 'fixed') {
        // Fixed monthly salary — only count if there are entries in this period
        if (workdays.length > 0) {
          brutto = job.fixedMonthlySalary || 0;
        }

        // Overtime calculation: hours beyond standardHoursPerDay × standardDaysPerWeek × 4.33 weeks
        // NOTE: overtime is intentionally based on actual worked hours only —
        // pending shifts are not counted toward overtime even in projected mode.
        if (workdays.length > 0 && job.standardHoursPerDay && job.standardDaysPerWeek && job.defaultHourlyRate) {
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
      } else if (job.salaryType === 'daily') {
        // Daily rate: sum of dailyRateOverride (or defaultDailyRate) for each worked day
        for (var d = 0; d < workdays.length; d++) {
          var dEntry = workdays[d];
          var dCounts = dEntry.status === 'worked' || (inclPending && dEntry.status === 'pending');
          if (dCounts) {
            var dayRate = (dEntry.dailyRateOverride !== null && dEntry.dailyRateOverride !== undefined)
              ? dEntry.dailyRateOverride
              : (job.defaultDailyRate || 0);
            brutto += dayRate;
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

      // Add provisions to brutto (tips are excluded) — only if there are actual workdays
      if (workdays.length > 0) {
        brutto += provisions;
      }

      // Round to 2 decimal places
      return Math.round(brutto * 100) / 100;
    }

    /**
     * Calculates yearly Brutto for a given job (sum of all monthly brutto values).
     * @param {string} jobId
     * @param {number} year
     * @param {boolean} [includePending=false]
     * @returns {number}
     */
    function calculateYearlyBrutto(jobId, year, includePending) {
      var total = 0;
      for (var m = 1; m <= 12; m++) {
        total += calculateMonthlyBrutto(jobId, year, m, includePending === true);
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
    /**
     * Calculates the German income tax for a given annual taxable income
     * using a smoothed approximation of the official 2026 progressive tax
     * formula (§32a EStG). Steuerklasse adjusts the effective taxable income
     * via the Grundfreibetrag (and other class-specific allowances).
     *
     * The four zones (in EUR) for 2026 (single / Steuerklasse I):
     *   Zone 1 (0 .. 12,348):              tax = 0
     *   Zone 2 (12,348 .. 17,005):         linearly rising marginal rate 14% → 24%
     *   Zone 3 (17,005 .. 66,760):         linearly rising marginal rate 24% → 42%
     *   Zone 4 (66,760 .. 277,825):        flat 42%
     *   Zone 5 (>277,825):                 flat 45% ("Reichensteuer")
     *
     * Steuerklasse V and VI use no Grundfreibetrag and a higher minimum rate;
     * we approximate with proportional zone shifts. Steuerklasse III gets the
     * doubled Grundfreibetrag, etc.
     *
     * Crucially, the formula is continuous — no cliffs. The public callers
     * pass MONTHLY brutto so we annualize internally.
     *
     * @param {number} monthlyBrutto - Monthly gross income
     * @param {number} steuerklasse  - Tax class (1-6)
     * @returns {number} Monthly income tax (rounded to cents)
     */
    function _calculateIncomeTax(monthlyBrutto, steuerklasse) {
      if (!monthlyBrutto || monthlyBrutto <= 0) return 0;

      // Annualize, then compute tax-free allowance per Steuerklasse.
      var annualBrutto = monthlyBrutto * 12;

      // Effective Grundfreibetrag per Steuerklasse for 2026 (Werbungskostenpauschale
      // 1,230€ + Sonderausgaben-Pauschale 36€ are bundled in for a fairer single
      // approximation since this is a take-home estimate).
      // Steuerklasse III gets the doubled Grundfreibetrag; V and VI get none.
      var freibetrag;
      switch (steuerklasse) {
        case 2: freibetrag = 12348 + 4260 + 1230 + 36; break; // + Entlastungsbetrag
        case 3: freibetrag = (12348 * 2) + 1230 + 36; break;  // doubled Grundfreibetrag
        case 4: freibetrag = 12348 + 1230 + 36; break;
        case 5: freibetrag = 0; break;
        case 6: freibetrag = 0; break;
        default: freibetrag = 12348 + 1230 + 36; // class 1
      }

      var taxableAnnual = annualBrutto - freibetrag;
      if (taxableAnnual <= 0) return 0;

      // Re-base into "zone math" that operates on (annualBrutto - 12,348)
      // in the standard formula. Since we already subtracted the relevant
      // freibetrag, we can apply zone progression directly on taxableAnnual.
      // For Steuerklasse V and VI, layer in a higher minimum tax via a
      // multiplier — these classes are rare for a part-time tracker, but we
      // provide a fair upper bound.
      var annualTax = _zoneTax2026(taxableAnnual);

      if (steuerklasse === 5 || steuerklasse === 6) {
        // V/VI bracket scaled up moderately to reflect "no allowances + min ~25%".
        // Real Klasse V depends heavily on combined income; this is a fair
        // single-job approximation.
        annualTax = Math.max(annualTax, taxableAnnual * 0.25);
      }

      var monthlyTax = annualTax / 12;
      if (monthlyTax < 0) monthlyTax = 0;
      return Math.round(monthlyTax * 100) / 100;
    }

    /**
     * Smoothed German income-tax zone formula (§32a EStG-style).
     * @param {number} zvE - "zu versteuerndes Einkommen" (annual taxable income)
     * @returns {number} Annual tax (Einkommensteuer)
     */
    function _zoneTax2026(zvE) {
      if (zvE <= 0) return 0;

      // Zone boundaries (annual, EUR) for 2026
      var Z1_END = 12348; // already deducted as freibetrag — zvE represents (annualBrutto - freibetrag)
      var Z2_END = 17005 - 12348; // ~4,657 → zvE position where zone 2 ends
      var Z3_END = 66760 - 12348; // ~54,412 → zvE position where zone 3 ends
      var Z4_END = 277825 - 12348; // ~265,477 → top-bracket transition

      if (zvE <= Z2_END) {
        // Zone 2: marginal rate rises linearly from 14% to ~24%.
        // Tax in zone 2 = ((rate(0) + rate(zvE)) / 2) * zvE   (trapezoidal area)
        // Marginal rate rises linearly: r(z) = 0.14 + (0.24 - 0.14) * (z / Z2_END)
        // → average over [0, zvE]: 0.14 + 0.05 * (zvE / Z2_END)
        var avgRateZ2 = 0.14 + 0.05 * (zvE / Z2_END);
        return zvE * avgRateZ2;
      }

      // Tax accumulated through end of zone 2
      var taxAtZ2End = Z2_END * 0.19; // average 14%→24% over the zone = 19%

      if (zvE <= Z3_END) {
        // Zone 3: marginal rate rises linearly from 24% to 42% over [Z2_END, Z3_END]
        var z3Span = Z3_END - Z2_END;
        var z3Pos = zvE - Z2_END;
        // average marginal in [Z2_END, zvE] = 0.24 + 0.09 * (z3Pos / z3Span)
        var avgRateZ3 = 0.24 + 0.09 * (z3Pos / z3Span);
        return taxAtZ2End + z3Pos * avgRateZ3;
      }

      // Tax accumulated through end of zone 3 = taxAtZ2End + (Z3_END - Z2_END) * 33%
      var taxAtZ3End = taxAtZ2End + (Z3_END - Z2_END) * 0.33;

      if (zvE <= Z4_END) {
        // Zone 4: flat 42% marginal
        return taxAtZ3End + (zvE - Z3_END) * 0.42;
      }

      // Zone 5: flat 45% marginal beyond Z4_END
      var taxAtZ4End = taxAtZ3End + (Z4_END - Z3_END) * 0.42;
      return taxAtZ4End + (zvE - Z4_END) * 0.45;
    }

    /**
     * Calculates Solidaritätszuschlag with the proper Milderungszone phase-in.
     * Below the lower threshold (18,130€ annual tax for Steuerklasse 1) no Soli
     * is charged. Between the lower and upper threshold (36,260€), Soli phases
     * in smoothly via:
     *
     *     soli = min(0.055 * annualTax, 0.119 * (annualTax - lowerThreshold))
     *
     * Above the upper threshold, the full 5.5% applies. This avoids cliffs.
     *
     * @param {number} monthlyIncomeTax - Monthly income tax amount
     * @param {number} steuerklasse - Tax class (1-6)
     * @param {number} soliRate - Full solidarity surcharge rate (e.g. 0.055)
     * @returns {number} Monthly Solidaritätszuschlag (rounded to cents)
     */
    function _calculateSoli(monthlyIncomeTax, steuerklasse, soliRate) {
      if (!monthlyIncomeTax || monthlyIncomeTax <= 0) return 0;

      var annualTax = monthlyIncomeTax * 12;

      // Lower / upper thresholds (annual income tax, EUR)
      var lower = 18130;
      var upper = 36260;
      if (steuerklasse === 3) {
        lower = 36260;
        upper = 72520;
      }

      if (annualTax <= lower) return 0;

      var fullSoli = annualTax * soliRate;
      var phaseIn = 0.119 * (annualTax - lower);

      var annualSoli = (annualTax >= upper) ? fullSoli : Math.min(fullSoli, phaseIn);
      if (annualSoli < 0) annualSoli = 0;

      return Math.round((annualSoli / 12) * 100) / 100;
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
     * @param {boolean} [includePending=false] - When true, also count pending entries
     * @returns {{ netto: number, available: boolean, reason?: string }}
     */
    function calculateMonthlyNetto(jobId, year, month, includePending) {
      var job = _findJob(jobId);
      if (!job) return { netto: 0, available: true };

      var brutto = calculateMonthlyBrutto(jobId, year, month, includePending === true);
      return _netFromBrutto(brutto, job, year);
    }

    /**
     * Public helper: calculate net income for a hypothetical monthly gross
     * using the same logic as calculateMonthlyNetto. Used by simulation
     * widgets (e.g. Stunden-Stepper) to project additional-hour scenarios
     * without re-implementing tax math.
     *
     * @param {string} jobId
     * @param {number} brutto - Hypothetical monthly gross
     * @param {number} [year] - Tax year (defaults to current year)
     * @returns {{ netto: number, available: boolean, reason?: string, deductions?: object }}
     */
    function calculateNetForBrutto(jobId, brutto, year) {
      var job = _findJob(jobId);
      if (!job) return { netto: 0, available: true };
      var y = (typeof year === 'number') ? year : new Date().getFullYear();
      var b = (typeof brutto === 'number' && isFinite(brutto) && brutto >= 0) ? brutto : 0;
      return _netFromBrutto(b, job, y);
    }

    /**
     * Internal: shared deduction logic used by both calculateMonthlyNetto and
     * calculateNetForBrutto. Takes a brutto amount, job, and year — returns the
     * full netto result with deduction breakdown.
     *
     * @param {number} brutto
     * @param {object} job
     * @param {number} year
     * @returns {{ netto: number, available: boolean, reason?: string, deductions?: object }}
     */
    function _netFromBrutto(brutto, job, year) {
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

      // Health insurance: only for gesetzlich (private/familienversicherung = no KV/PV deduction)
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
      // Familienversicherung: keine KV/PV-Beiträge (healthContrib + careContrib bleiben 0)

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
     * @param {boolean} [includePending=false]
     * @returns {{ netto: number, available: boolean, reason?: string }}
     */
    function calculateYearlyNetto(jobId, year, includePending) {
      var total = 0;
      for (var m = 1; m <= 12; m++) {
        var monthResult = calculateMonthlyNetto(jobId, year, m, includePending === true);
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
     * @param {boolean} [includePending=false]
     * @returns {{ hours: number, workingDays: number, vacationDays: number, sickDays: number }}
     */
    function _getJobMonthStats(jobId, year, month, includePending) {
      var workdays = _getWorkdaysForMonth(jobId, year, month);
      var inclPending = includePending === true;
      var hours = 0;
      var workingDays = 0;
      var vacationDays = 0;
      var sickDays = 0;

      for (var i = 0; i < workdays.length; i++) {
        var entry = workdays[i];
        if (entry.status === 'worked' || (inclPending && entry.status === 'pending')) {
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
     * @param {boolean} [includePending=false]
     * @returns {{ hours: number, workingDays: number, vacationDays: number, sickDays: number }}
     */
    function _getJobYearStats(jobId, year, includePending) {
      var workdays = _getWorkdaysForYear(jobId, year);
      var inclPending = includePending === true;
      var hours = 0;
      var workingDays = 0;
      var vacationDays = 0;
      var sickDays = 0;

      for (var i = 0; i < workdays.length; i++) {
        var entry = workdays[i];
        if (entry.status === 'worked' || (inclPending && entry.status === 'pending')) {
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
     * @param {boolean} [includePending=false] - When true, also count pending entries
     * @returns {object} AggregateTotals with backward-compatible fields
     */
    function getAggregatedYearly(year, includePending) {
      var jobs = AppState.getState().jobs;
      var inclPending = includePending === true;
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
        var brutto = calculateYearlyBrutto(job.id, year, inclPending);
        var nettoResult = calculateYearlyNetto(job.id, year, inclPending);
        var tips = getTipTotal(job.id, year);
        var provisions = getProvisionTotal(job.id, year);
        var stats = _getJobYearStats(job.id, year, inclPending);

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
      calculateNetForBrutto: calculateNetForBrutto,
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

      // Count working days for ALL KFB jobs in the year (legally they're combined)
      var workdays = AppState.getState().workdays;
      var allJobs = AppState.getState().jobs;
      var kfbJobIds = [];
      for (var j = 0; j < allJobs.length; j++) {
        if (allJobs[j].type === 'KFB') kfbJobIds.push(allJobs[j].id);
      }

      var yearPrefix = String(year) + '-';
      var workedDays = 0;
      var hasAnyData = false;

      for (var i = 0; i < workdays.length; i++) {
        var wd = workdays[i];
        if (kfbJobIds.indexOf(wd.jobId) === -1 || !wd.date || !wd.date.startsWith(yearPrefix)) continue;
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

    /**
     * Checks if the user is approaching the Familienversicherung income limit.
     * Limit: 565 €/month total income (603 € for Minijob).
     * @param {number} year
     * @param {number} month
     * @returns {object|null} { current, limit, percentage, warningLevel } or null if not familienversichert
     */
    function checkFamilienversicherungLimit(year, month) {
      var profile = AppState.getState().userProfile;
      if (!profile || profile.krankenversicherung !== 'familienversicherung') {
        return null;
      }

      // Calculate total monthly income across all jobs
      // KFB is EXCLUDED — it's SV-frei and doesn't count towards FV limit
      // (employer pays flat 25% tax, no employee income for FV purposes)
      var jobs = AppState.getState().jobs;
      var totalIncome = 0;
      var hasMinijob = false;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].type === 'KFB') continue; // KFB doesn't count
        var brutto = IncomeEngine.calculateMonthlyBrutto(jobs[i].id, year, month);
        totalIncome += brutto;
        if (jobs[i].type === 'Minijob') hasMinijob = true;
      }

      // Limit: 565€/month general, 603€ if only Minijob income
      var limit = hasMinijob ? 603 : 565;
      var percentage = limit > 0 ? Math.round((totalIncome / limit) * 100) : 0;
      var warningLevel = percentage >= 100 ? 'critical' : (percentage >= 80 ? 'warning' : 'safe');

      return {
        current: Math.round(totalIncome * 100) / 100,
        limit: limit,
        percentage: percentage,
        warningLevel: warningLevel,
        displayWarningLevel: warningLevel
      };
    }

    return {
      init: init,
      checkMinijobLimit: checkMinijobLimit,
      check26WeekRule: check26WeekRule,
      checkKFBDays: checkKFBDays,
      checkFamilienversicherungLimit: checkFamilienversicherungLimit,
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
      var validStatuses = ['worked', 'vacation', 'sick', 'not_worked', 'pending'];
      if (!entry.status || validStatuses.indexOf(entry.status) === -1) {
        errors.push('Gültiger Status ist erforderlich.');
      }

      // Hours validation (only for worked status, not required for daily rate jobs)
      if (entry.status === 'worked') {
        var hasDailyRate = entry.dailyRateOverride !== null && entry.dailyRateOverride !== undefined && entry.dailyRateOverride !== '';
        if (!hasDailyRate && (entry.hours === null || entry.hours === undefined || entry.hours === '')) {
          errors.push('Stunden sind für Arbeitseinträge erforderlich.');
        } else if (entry.hours !== null && entry.hours !== undefined && entry.hours !== '') {
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

      // If jobId is provided, check if that job has a billing day
      if (jobId) {
        var jobs = AppState.getState().jobs;
        var job = null;
        for (var j = 0; j < jobs.length; j++) {
          if (jobs[j].id === jobId) { job = jobs[j]; break; }
        }
        if (job && job.billingDay) {
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
          return workdays.filter(function (w) {
            return w.jobId === jobId && w.date && w.date >= startDate && w.date <= endDate;
          });
        }
      }

      // Standard calendar month filtering
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
        hours: entry.status === 'worked' && entry.hours ? parseFloat(entry.hours) : null,
        hourlyRateOverride: (entry.hourlyRateOverride !== null && entry.hourlyRateOverride !== undefined && entry.hourlyRateOverride !== '') ? parseFloat(entry.hourlyRateOverride) : null,
        dailyRateOverride: (entry.dailyRateOverride !== null && entry.dailyRateOverride !== undefined && entry.dailyRateOverride !== '') ? parseFloat(entry.dailyRateOverride) : null,
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

      // Also delete associated earnings (provision/tips) for this job+date
      if (deletedEntry.jobId && deletedEntry.date) {
        var dateParts = deletedEntry.date.split('-');
        var entryYear = parseInt(dateParts[0], 10);
        // Get all earnings for this job in the year (without month filter to avoid billing period issues)
        var allEarnings = EarningsExtraModule.getForJob(deletedEntry.jobId, entryYear);
        if (allEarnings && allEarnings.length > 0) {
          for (var ei = 0; ei < allEarnings.length; ei++) {
            if (allEarnings[ei].date === deletedEntry.date) {
              EarningsExtraModule.deleteEarning(allEarnings[ei].id);
            }
          }
        }
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
      var kvTyp = profile && profile.krankenversicherung ? (profile.krankenversicherung === 'gesetzlich' ? 'Gesetzlich' : profile.krankenversicherung === 'familienversicherung' ? 'Familienversicherung' : 'Privat') : '—';
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
      html += '<label class="radio-label">';
      html += '<input type="radio" name="pd-krankenversicherung" value="familienversicherung" class="radio-input"' + (currentKV === 'familienversicherung' ? ' checked' : '') + '>';
      html += '<span class="radio-custom"></span>';
      html += '<span class="radio-text">Familienversicherung</span>';
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
    const APP_VERSION = '3.1.2';
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

  // ─── ICSImportModule ─────────────────────────────────────────────────────────
  // v2.2.0 — Imports shifts from a standard iCalendar (.ics) file.
  //
  // Behavior:
  //   • Parses .ics text into VEVENT entries (handles RFC 5545 line folding).
  //   • Converts each VEVENT into a workday entry on the chosen job.
  //   • Append-mode: existing manual entries are preserved.
  //   • Same date + start time on the same job → existing entry is UPDATED
  //     (hours overwritten) rather than duplicated.
  //   • Re-importing the same .ics is idempotent.
  //
  // Persistence: writes directly to AppState.workdays so we can preserve
  // ICS-specific fields (icsUid, startTime) for future round-trips and the
  // duplicate-detection key. Entries integrate seamlessly with existing
  // calculations (IncomeEngine, LimitMonitor, dashboard) because they live
  // in the same workdays array under the same shape.
  const ICSImportModule = (function () {
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
     * Formats a Date as YYYY-MM-DD using local time components.
     * @param {Date} d
     * @returns {string}
     */
    function _formatDate(d) {
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    }

    /**
     * Returns true when the given YYYY-MM-DD string is strictly after today
     * (using local time). Used by the ICS importer to mark future shifts as
     * 'pending' so they don't count toward brutto until confirmed.
     * @param {string} dateStr
     * @returns {boolean}
     */
    function _isFutureDate(dateStr) {
      if (!dateStr) return false;
      var today = new Date();
      var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      return dateStr > todayStr;
    }

    /**
     * Formats a Date as HH:MM using local time components.
     * @param {Date} d
     * @returns {string}
     */
    function _formatTime(d) {
      var hh = String(d.getHours()).padStart(2, '0');
      var mi = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mi;
    }

    /**
     * Unescapes iCalendar text values per RFC 5545 section 3.3.11.
     * @param {string} s
     * @returns {string}
     */
    function _unescape(s) {
      if (s == null) return '';
      return String(s)
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
    }

    /**
     * Parses a single DTSTART/DTEND value. Handles:
     *   • 20260525T090000Z         (UTC)
     *   • 20260525T090000          (local / floating)
     *   • 20260525                 (date-only)
     *   • TZID=Europe/Berlin:20260525T090000  (TZID prefix gets stripped)
     * @param {string} s
     * @returns {Date|null}
     */
    function _parseICSDate(s) {
      if (!s) return null;
      s = String(s).trim();
      // Strip leading TZID=...: prefix if it slipped through
      s = s.replace(/^TZID=[^:]+:/i, '');
      var m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
      if (!m) return null;
      var year = parseInt(m[1], 10);
      var month = parseInt(m[2], 10) - 1;
      var day = parseInt(m[3], 10);
      var hour = m[4] ? parseInt(m[4], 10) : 0;
      var minute = m[5] ? parseInt(m[5], 10) : 0;
      var second = m[6] ? parseInt(m[6], 10) : 0;
      if (m[7] === 'Z') {
        return new Date(Date.UTC(year, month, day, hour, minute, second));
      }
      return new Date(year, month, day, hour, minute, second);
    }

    // ── ICS Parsing ──

    /**
     * Parses an iCalendar (.ics) text body into an array of events.
     * @param {string} text
     * @returns {Array<{ uid:string|null, dtStart:Date|null, dtEnd:Date|null, summary:string, location:string }>}
     */
    function parseICS(text) {
      if (typeof text !== 'string' || !text) return [];
      // Normalize line endings, then unfold continuation lines
      // (RFC 5545: a line beginning with whitespace is a continuation of the previous one).
      var normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
      var lines = normalized.split('\n');

      var events = [];
      var current = null;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) continue;

        if (line === 'BEGIN:VEVENT') {
          current = { uid: null, dtStart: null, dtEnd: null, summary: '', location: '' };
        } else if (line === 'END:VEVENT') {
          if (current) {
            events.push(current);
            current = null;
          }
        } else if (current) {
          var colonIdx = line.indexOf(':');
          if (colonIdx < 0) continue;
          var keyPart = line.substring(0, colonIdx);
          var value = line.substring(colonIdx + 1);
          var key = keyPart.split(';')[0].toUpperCase();

          switch (key) {
            case 'UID':
              current.uid = value;
              break;
            case 'DTSTART':
              current.dtStart = _parseICSDate(value);
              break;
            case 'DTEND':
              current.dtEnd = _parseICSDate(value);
              break;
            case 'SUMMARY':
              current.summary = _unescape(value);
              break;
            case 'LOCATION':
              current.location = _unescape(value);
              break;
            default:
              break;
          }
        }
      }

      return events;
    }

    // ── Workday lookup / persistence ──

    /**
     * Finds an existing workday entry on (jobId, date, startTime).
     * The startTime match is what makes re-import idempotent: the same shift
     * imported twice will resolve to the same row.
     * @param {string} jobId
     * @param {string} date - YYYY-MM-DD
     * @param {string} startTime - HH:MM
     * @returns {object|null}
     */
    function _findExistingEntry(jobId, date, startTime) {
      var workdays = AppState.getState().workdays || [];
      for (var i = 0; i < workdays.length; i++) {
        var w = workdays[i];
        if (w.jobId === jobId && w.date === date && w.startTime === startTime) {
          return w;
        }
      }
      return null;
    }

    /**
     * Persists the workdays array via AppState.
     * @param {Array} workdays
     * @returns {{ success:boolean, error?:string }}
     */
    function _saveWorkdays(workdays) {
      return AppState.setState('workdays', workdays);
    }

    /**
     * Converts a parsed VEVENT into a workday entry skeleton.
     * Returns null if the event is missing dates or has non-positive duration.
     * @param {object} ev
     * @param {object} job
     * @returns {{ hours:number, date:string, startTime:string }|null}
     */
    function _eventToEntry(ev, job) {
      if (!ev || !ev.dtStart || !ev.dtEnd) return null;
      var ms = ev.dtEnd.getTime() - ev.dtStart.getTime();
      if (!isFinite(ms) || ms <= 0) return null;
      var hours = ms / (1000 * 60 * 60);
      // Round to nearest 0.25h to match TimeTrackerModule validation
      hours = Math.round(hours * 4) / 4;
      // Clamp to allowed range (TimeTrackerModule rejects > 24h)
      if (hours <= 0 || hours > 24) return null;
      return {
        hours: hours,
        date: _formatDate(ev.dtStart),
        startTime: _formatTime(ev.dtStart),
        // Job is intentionally accepted even if not used here; reserved for
        // future per-job rate snapshotting.
        _job: job || null
      };
    }

    // ── Import ──

    /**
     * Imports a list of parsed VEVENTs as workday entries on the chosen job.
     * One entry per (jobId, date): if an entry already exists for the job on
     * that date — whether manual or from a prior import — its hours are
     * overwritten. This makes re-imports idempotent.
     *
     * @param {Array} events - From parseICS()
     * @param {string} jobId - Target job
     * @returns {{ added:number, updated:number, skipped:number, error?:string }}
     */
    function importEvents(events, jobId) {
      var result = { added: 0, updated: 0, skipped: 0 };
      if (!events || !events.length) return result;
      if (!jobId) {
        result.error = 'Job nicht gefunden';
        return result;
      }
      var job = JobManager.getJob(jobId);
      if (!job) {
        result.error = 'Job nicht gefunden';
        return result;
      }

      // Snapshot the workdays array so we mutate locally and persist once.
      var workdays = (AppState.getState().workdays || []).slice();

      // Build a lookup index by jobId|date — one entry per job per day.
      // If multiple entries exist for the same job+date, keep the last one
      // (most recent index) so updates target the freshest record.
      var index = {};
      for (var k = 0; k < workdays.length; k++) {
        var w = workdays[k];
        if (!w || !w.date) continue;
        if (w.jobId !== jobId) continue;
        // Match by date only (not startTime) — one shift per job per day.
        index[w.date] = k;
      }

      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var built = _eventToEntry(ev, job);
        if (!built) {
          result.skipped++;
          continue;
        }

        var key = built.date;
        var existingIdx = index[key];
        var nowIso = new Date().toISOString();

        if (typeof existingIdx === 'number' && workdays[existingIdx]) {
          // Update hours (and refresh ICS metadata) in place.
          var prev = workdays[existingIdx];
          var updated = Object.assign({}, prev, {
            hours: built.hours,
            status: prev.status === 'vacation' || prev.status === 'sick' ? prev.status : (_isFutureDate(built.date) ? 'pending' : 'worked'),
            startTime: built.startTime,
            icsUid: ev.uid || prev.icsUid || null,
            updatedAt: nowIso
          });
          // Preserve note unless the existing one is empty
          if (!prev.note && ev.summary) {
            updated.note = ev.summary;
          }
          workdays[existingIdx] = updated;
          result.updated++;
        } else {
          // New entry — full WorkDay shape so existing modules consume it.
          var newEntry = {
            id: _generateUUID(),
            jobId: jobId,
            date: built.date,
            status: _isFutureDate(built.date) ? 'pending' : 'worked',
            hours: built.hours,
            hourlyRateOverride: null,
            dailyRateOverride: null,
            note: ev.summary || null,
            paidSickLeave: false,
            // ICS-specific metadata (kept on the entry for idempotent re-import)
            startTime: built.startTime,
            icsUid: ev.uid || null,
            location: ev.location || null,
            source: 'ics',
            createdAt: nowIso,
            updatedAt: nowIso
          };
          workdays.push(newEntry);
          // Index the freshly added entry so a subsequent VEVENT with the
          // same date updates rather than duplicates it.
          index[key] = workdays.length - 1;
          result.added++;
        }
      }

      var save = _saveWorkdays(workdays);
      if (!save.success) {
        result.error = 'Speichern fehlgeschlagen';
        return result;
      }

      // Notify the rest of the app so dashboards / forecasts refresh.
      if (typeof EventBus !== 'undefined') {
        EventBus.emit('workday:saved', {});
        EventBus.emit('income:updated', {});
      }

      return result;
    }

    // ── UI ──

    /**
     * Populates the job picker from JobManager.
     */
    function _populateJobDropdown() {
      var sel = document.getElementById('ics-import-job');
      if (!sel) return;
      var prev = sel.value;
      var jobs = (typeof JobManager !== 'undefined' && JobManager.getAllJobs)
        ? JobManager.getAllJobs() || []
        : [];
      var html = '';
      if (!jobs.length) {
        html = '<option value="">— Keine Jobs konfiguriert —</option>';
      } else {
        for (var i = 0; i < jobs.length; i++) {
          var j = jobs[i];
          var label = (j.employerName || j.name || 'Job') + (j.jobType ? ' (' + j.jobType + ')' : '');
          html += '<option value="' + j.id + '">' + _escapeForAttr(label) + '</option>';
        }
      }
      sel.innerHTML = html;
      // Restore previous selection if still present
      if (prev) {
        for (var k = 0; k < sel.options.length; k++) {
          if (sel.options[k].value === prev) { sel.value = prev; break; }
        }
      }
    }

    function _escapeForAttr(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Renders the import status block under the picker.
     * @param {{added:number, updated:number, skipped:number, error?:string}} res
     */
    function _showStatus(res) {
      var el = document.getElementById('ics-import-status');
      if (!el) return;
      el.classList.remove('ics-import-status--error', 'ics-import-status--warn');

      if (!res || res.error) {
        el.classList.add('ics-import-status--error');
        el.textContent = '⚠️ ' + ((res && res.error) || 'Import fehlgeschlagen.');
        el.style.display = '';
        return;
      }

      var lines = [];
      if (res.added > 0) {
        lines.push('✓ ' + res.added + (res.added === 1 ? ' Schicht importiert' : ' Schichten importiert'));
      }
      if (res.updated > 0) {
        lines.push('↻ ' + res.updated + (res.updated === 1 ? ' Schicht aktualisiert' : ' Schichten aktualisiert'));
      }
      if (res.skipped > 0) {
        lines.push('⊘ ' + res.skipped + (res.skipped === 1 ? ' Schicht übersprungen' : ' Schichten übersprungen'));
      }
      if (!lines.length) {
        el.classList.add('ics-import-status--warn');
        el.textContent = 'Keine importierbaren Termine in der Datei gefunden.';
      } else {
        el.textContent = lines.join('\n');
      }
      el.style.display = '';
    }

    function _onFileChosen(file) {
      if (!file) return;
      var sel = document.getElementById('ics-import-job');
      var jobId = sel ? sel.value : '';
      if (!jobId) {
        _showStatus({ added: 0, updated: 0, skipped: 0, error: 'Bitte zuerst einen Job auswählen.' });
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = String(reader.result || '');
          var events = parseICS(text);
          var result = importEvents(events, jobId);
          _showStatus(result);
        } catch (e) {
          _showStatus({ added: 0, updated: 0, skipped: 0, error: 'Datei konnte nicht gelesen werden.' });
        }
      };
      reader.onerror = function () {
        _showStatus({ added: 0, updated: 0, skipped: 0, error: 'Datei konnte nicht gelesen werden.' });
      };
      reader.readAsText(file);
    }

    /**
     * Initializes the ICSImportModule. Idempotent.
     */
    function init() {
      if (_initialized) {
        // Refresh dropdown in case jobs changed since last init
        _populateJobDropdown();
        return;
      }
      _initialized = true;

      _populateJobDropdown();

      var btn = document.getElementById('ics-import-btn');
      var fileInput = document.getElementById('ics-file-input');

      if (btn && fileInput) {
        btn.addEventListener('click', function () {
          // Reset so picking the same file twice still triggers `change`
          fileInput.value = '';
          fileInput.click();
        });

        fileInput.addEventListener('change', function (e) {
          var file = e.target.files && e.target.files[0];
          _onFileChosen(file);
        });
      }

      // Keep the dropdown fresh when jobs change.
      if (typeof EventBus !== 'undefined' && EventBus.on) {
        EventBus.on('job:created', _populateJobDropdown);
        EventBus.on('job:updated', _populateJobDropdown);
        EventBus.on('job:deleted', _populateJobDropdown);
      }
    }

    return {
      init: init,
      parseICS: parseICS,
      importEvents: importEvents
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
     * Renders the day-by-day chronological list. Entries are gathered per-job
     * using each job's billing period (so an entry on May 25 with billingDay=20
     * shows up in June, the next billing period). Entries belonging to deleted
     * jobs fall back to calendar-month filtering so they aren't lost.
     */
    function _renderDayList() {
      var container = document.getElementById('monthly-day-list');
      if (!container) return;

      // Gather entries from ALL jobs, each according to its billing period.
      var jobs = AppState.getState().jobs || [];
      var allEntries = [];
      var collectedIds = {};
      for (var j = 0; j < jobs.length; j++) {
        var jobEntries = TimeTrackerModule.getEntriesForMonth(_selectedYear, _selectedMonth, jobs[j].id);
        for (var e = 0; e < jobEntries.length; e++) {
          if (!collectedIds[jobEntries[e].id]) {
            allEntries.push(jobEntries[e]);
            collectedIds[jobEntries[e].id] = true;
          }
        }
      }

      // Include orphaned entries (job no longer exists) using calendar-month filtering.
      var workdays = AppState.getState().workdays || [];
      var prefix = _selectedYear + '-' + String(_selectedMonth).padStart(2, '0');
      for (var w = 0; w < workdays.length; w++) {
        if (collectedIds[workdays[w].id]) continue;
        if (!workdays[w].date || workdays[w].date.indexOf(prefix) !== 0) continue;
        var jobExists = false;
        for (var jj = 0; jj < jobs.length; jj++) {
          if (jobs[jj].id === workdays[w].jobId) { jobExists = true; break; }
        }
        if (!jobExists) {
          allEntries.push(workdays[w]);
          collectedIds[workdays[w].id] = true;
        }
      }

      // Update the section header to indicate billing-period awareness when at
      // least one job has a custom billing day configured.
      var titleEl = document.getElementById('monthly-day-list-title');
      if (titleEl) {
        var hasBillingDay = false;
        for (var bj = 0; bj < jobs.length; bj++) {
          if (jobs[bj].billingDay && jobs[bj].billingDay > 0) { hasBillingDay = true; break; }
        }
        titleEl.textContent = hasBillingDay ? 'Tag für Tag (Abrechnungszeitraum)' : 'Tag für Tag';
      }

      if (!allEntries || allEntries.length === 0) {
        container.innerHTML = '<p class="monthly-empty-state">Keine Einträge für diesen Abrechnungszeitraum.</p>';
        return;
      }

      // Sort entries by date descending (most recent first)
      allEntries.sort(function (a, b) {
        return b.date.localeCompare(a.date);
      });

      var html = '<div class="monthly-day-entries">';
      for (var i = 0; i < allEntries.length; i++) {
        var entry = allEntries[i];
        var job = _findJob(entry.jobId);
        var jobName = job ? job.employerName : 'Unbekannt';
        // German status labels per requirement 10.5
        var statusLabel;
        switch (entry.status) {
          case 'worked': statusLabel = 'gearbeitet'; break;
          case 'vacation': statusLabel = 'Urlaub'; break;
          case 'sick': statusLabel = 'krank'; break;
          case 'not_worked': statusLabel = 'nicht gearbeitet'; break;
          case 'pending': statusLabel = 'ausstehend'; break;
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
    let _editingEntryId = null; // null = create new entry, otherwise editing existing entry
    let _recentListClickBound = false; // ensure tap-to-edit delegation is bound only once
    var _historyFilter = 'current_month'; // 'all', 'current_month', 'last_month', 'YYYY-MM'

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
      var dailyRateGroup = document.getElementById('entry-daily-rate-group');
      var hoursGroup = document.getElementById('entry-hours-group');
      if (!jobSelect) return;

      var selectedJobId = jobSelect.value;
      var jobs = JobManager.getActiveJobs();
      var selectedJob = null;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === selectedJobId) { selectedJob = jobs[i]; break; }
      }

      if (provisionGroup) provisionGroup.style.display = (selectedJob && selectedJob.hasProvision) ? '' : 'none';
      if (tipGroup) tipGroup.style.display = (selectedJob && selectedJob.hasTipTracking) ? '' : 'none';

      // Show daily rate field for daily salary type, hide hours
      var isDaily = selectedJob && selectedJob.salaryType === 'daily';
      if (dailyRateGroup) dailyRateGroup.style.display = isDaily ? '' : 'none';
      if (hoursGroup && isDaily) hoursGroup.style.display = 'none';
      if (hoursGroup && !isDaily) hoursGroup.style.display = '';

      // Pre-fill daily rate with default if available
      if (isDaily && selectedJob.defaultDailyRate) {
        var drInput = document.getElementById('entry-daily-rate');
        if (drInput && !drInput.value) drInput.value = selectedJob.defaultDailyRate;
      }
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

      // Determine if this is a daily-rate job
      var jobs = JobManager.getActiveJobs();
      var selectedJob = null;
      for (var ji = 0; ji < jobs.length; ji++) {
        if (jobs[ji].id === jobId) { selectedJob = jobs[ji]; break; }
      }
      var isDaily = selectedJob && selectedJob.salaryType === 'daily';
      var dailyRateInput = document.getElementById('entry-daily-rate');
      var dailyRateValue = null;

      if (status === 'worked') {
        if (isDaily) {
          // Daily rate: validate the rate, hours are optional
          dailyRateValue = parseFloat(dailyRateInput ? dailyRateInput.value : '');
          if (isNaN(dailyRateValue) || dailyRateValue <= 0) {
            if (errorEl) errorEl.textContent = 'Bitte einen gültigen Tagessatz eingeben.';
            return;
          }
          // Hours optional for daily rate — use value if provided
          var hoursVal = parseFloat(hoursInput ? hoursInput.value : '');
          hours = (!isNaN(hoursVal) && hoursVal > 0) ? hoursVal : null;
        } else {
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
      }

      var entryData = {
        jobId: jobId,
        date: date,
        status: status,
        hours: hours
      };
      // Store daily rate override on the entry
      if (isDaily && dailyRateValue) {
        entryData.dailyRateOverride = dailyRateValue;
      }

      // ── EDIT MODE: update existing entry + replace earnings ──
      if (_editingEntryId) {
        // Capture old entry data BEFORE updateEntry mutates state, so we can find
        // the right job+date to clear earnings from (in case the user changed them).
        var oldEntry = null;
        var workdaysBefore = AppState.getState().workdays;
        for (var wb = 0; wb < workdaysBefore.length; wb++) {
          if (workdaysBefore[wb].id === _editingEntryId) {
            oldEntry = workdaysBefore[wb];
            break;
          }
        }

        var updateResult = TimeTrackerModule.updateEntry(_editingEntryId, entryData);
        if (!updateResult.success) {
          if (errorEl) errorEl.textContent = updateResult.error || 'Fehler beim Aktualisieren.';
          return;
        }

        // Delete old earnings for the entry's previous job+date AND for the new
        // job+date (if either changed). This prevents stale provision/tip rows.
        function _clearEarningsForJobAndDate(targetJobId, targetDate) {
          if (!targetJobId || !targetDate) return;
          var year = parseInt(String(targetDate).substring(0, 4), 10);
          if (!year) return;
          var earnings = EarningsExtraModule.getForJob(targetJobId, year);
          for (var oe = 0; oe < earnings.length; oe++) {
            if (earnings[oe].date === targetDate) {
              EarningsExtraModule.deleteEarning(earnings[oe].id);
            }
          }
        }
        if (oldEntry) {
          _clearEarningsForJobAndDate(oldEntry.jobId, oldEntry.date);
        }
        if (!oldEntry || oldEntry.jobId !== jobId || oldEntry.date !== date) {
          _clearEarningsForJobAndDate(jobId, date);
        }

        // Save new provision if entered (only if the field is visible/applicable)
        var editProvisionAmount = parseFloat(provisionInput ? provisionInput.value : '');
        if (!isNaN(editProvisionAmount) && editProvisionAmount > 0) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: date,
            type: 'provision',
            amount: editProvisionAmount
          });
        }
        // Save new tip if entered
        var editTipAmount = parseFloat(tipInput ? tipInput.value : '');
        if (!isNaN(editTipAmount) && editTipAmount > 0) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: date,
            type: 'tip',
            amount: editTipAmount
          });
        }

        showToast('Eintrag aktualisiert ✓');
        _exitEditMode();
        _renderRecentEntries();
        return;
      }

      // ── CREATE MODE: existing logic ──
      var result = TimeTrackerModule.createEntry(entryData);

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
     * Enters edit mode for an existing workday entry: populates the form with
     * the entry's current values (job, date, status, hours, daily-rate override),
     * loads any existing provision/tip earnings for that day+job into the form,
     * relabels the form to "Eintrag bearbeiten", and shows a Cancel button.
     * @param {string} entryId
     */
    function _enterEditMode(entryId) {
      var workdays = AppState.getState().workdays;
      var entry = null;
      for (var i = 0; i < workdays.length; i++) {
        if (workdays[i].id === entryId) { entry = workdays[i]; break; }
      }
      if (!entry) return;

      _editingEntryId = entryId;

      var jobSelect = document.getElementById('entry-job');
      var dateInput = document.getElementById('entry-date');
      var statusSelect = document.getElementById('entry-status');
      var hoursInput = document.getElementById('entry-hours');
      var provisionInput = document.getElementById('entry-provision');
      var tipInput = document.getElementById('entry-tip');
      var dailyRateInput = document.getElementById('entry-daily-rate');
      var errorEl = document.getElementById('entry-error');

      if (errorEl) errorEl.textContent = '';
      if (jobSelect) jobSelect.value = entry.jobId;
      if (dateInput) dateInput.value = entry.date;
      if (statusSelect) statusSelect.value = entry.status || 'worked';
      if (hoursInput) hoursInput.value = (entry.hours != null && entry.hours !== '') ? entry.hours : '';
      if (dailyRateInput) {
        dailyRateInput.value = entry.dailyRateOverride ? entry.dailyRateOverride : '';
      }

      // Update extra-fields visibility based on selected job + status
      _updateExtraFields();
      var hoursGroup = document.getElementById('entry-hours-group');
      if (hoursGroup) {
        // Hours visibility follows status (and isDaily, handled inside _updateExtraFields)
        var jobs = JobManager.getActiveJobs();
        var selectedJob = null;
        for (var sj = 0; sj < jobs.length; sj++) {
          if (jobs[sj].id === entry.jobId) { selectedJob = jobs[sj]; break; }
        }
        var isDailyJob = selectedJob && selectedJob.salaryType === 'daily';
        if (entry.status !== 'worked') {
          hoursGroup.style.display = 'none';
        } else if (isDailyJob) {
          hoursGroup.style.display = 'none';
        } else {
          hoursGroup.style.display = '';
        }
      }

      // Load existing provision + tip earnings for this date+job into the form
      var year = parseInt(String(entry.date).substring(0, 4), 10);
      var existingEarnings = year ? EarningsExtraModule.getForJob(entry.jobId, year) : [];
      var totalProvision = 0;
      var totalTip = 0;
      for (var e = 0; e < existingEarnings.length; e++) {
        if (existingEarnings[e].date === entry.date) {
          if (existingEarnings[e].type === 'provision') totalProvision += existingEarnings[e].amount;
          else if (existingEarnings[e].type === 'tip') totalTip += existingEarnings[e].amount;
        }
      }
      if (provisionInput) {
        provisionInput.value = totalProvision > 0 ? totalProvision.toFixed(2) : '';
      }
      if (tipInput) {
        tipInput.value = totalTip > 0 ? totalTip.toFixed(2) : '';
      }

      // Relabel form for edit mode
      var formTitle = document.getElementById('entry-form-title');
      var submitBtn = document.getElementById('entry-submit-btn');
      if (formTitle) formTitle.textContent = 'Eintrag bearbeiten';
      if (submitBtn) submitBtn.textContent = 'Änderungen speichern';

      // Highlight the form card so the user sees they're in edit mode
      var formCard = document.querySelector('.entry-form-card');
      if (formCard) formCard.classList.add('editing');

      _showEditCancelButton();

      // Scroll the form into view so the user sees the populated fields immediately
      if (formCard && typeof formCard.scrollIntoView === 'function') {
        try {
          formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (err) {
          // Older Safari versions: fall back to plain scroll
          formCard.scrollIntoView();
        }
      }
    }

    /**
     * Exits edit mode and restores the form to its default "create new entry" state.
     */
    function _exitEditMode() {
      _editingEntryId = null;

      var formTitle = document.getElementById('entry-form-title');
      var submitBtn = document.getElementById('entry-submit-btn');
      if (formTitle) formTitle.textContent = 'Neuer Eintrag';
      if (submitBtn) submitBtn.textContent = 'Eintrag speichern';

      var form = document.getElementById('entry-form');
      if (form) form.reset();

      // Restore today's date as the default
      var dateInput = document.getElementById('entry-date');
      if (dateInput) {
        var today = new Date();
        dateInput.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      }
      // Default status back to "worked"
      var statusSelect = document.getElementById('entry-status');
      if (statusSelect) statusSelect.value = 'worked';

      var formCard = document.querySelector('.entry-form-card');
      if (formCard) formCard.classList.remove('editing');

      _hideEditCancelButton();
      _updateExtraFields();
    }

    /**
     * Inserts (or shows) the "Abbrechen" button used to leave edit mode without saving.
     */
    function _showEditCancelButton() {
      var actions = document.querySelector('#entry-form .form-actions');
      if (!actions) return;
      var cancelBtn = document.getElementById('entry-edit-cancel-btn');
      if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'entry-edit-cancel-btn';
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.style.width = '100%';
        cancelBtn.textContent = 'Abbrechen';
        cancelBtn.addEventListener('click', _exitEditMode);
        actions.appendChild(cancelBtn);
      }
      cancelBtn.style.display = '';
    }

    function _hideEditCancelButton() {
      var cancelBtn = document.getElementById('entry-edit-cancel-btn');
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    /**
     * Binds a single delegated click handler on the recent-entries list. The
     * handler enters edit mode for the tapped entry, while ignoring taps on the
     * swipe-delete button or on entries currently in the swiped-open state.
     */
    function _bindRecentListClickHandler() {
      if (_recentListClickBound) return;
      var listEl = document.getElementById('entry-recent-list');
      if (!listEl) return;
      listEl.addEventListener('click', function (e) {
        // Pending action buttons take priority — they manage their own state
        // and shouldn't fall through to tap-to-edit.
        var actionBtn = e.target.closest ? e.target.closest('.entry-pending-btn') : null;
        if (actionBtn) {
          e.stopPropagation();
          var pendingId = actionBtn.getAttribute('data-entry-id');
          var action = actionBtn.getAttribute('data-pending-action');
          if (!pendingId) return;
          if (action === 'confirm') {
            var upd = TimeTrackerModule.updateEntry(pendingId, { status: 'worked' });
            if (upd && upd.success === false) {
              showToast(upd.error || 'Fehler beim Bestätigen.', 4000);
            } else {
              showToast('Schicht bestätigt ✓');
            }
          } else if (action === 'decline') {
            TimeTrackerModule.deleteEntry(pendingId);
            showToast('Schicht entfernt');
          }
          setTimeout(function () { _renderRecentEntries(); }, 100);
          return;
        }

        var entryEl = e.target.closest ? e.target.closest('.entry-recent-item') : null;
        if (!entryEl) return;
        // Pending entries have their own action buttons — never enter edit mode.
        if (entryEl.classList.contains('entry-pending')) return;
        // Don't enter edit mode when the entry is swiped open (the user is
        // interacting with the swipe-to-delete affordance).
        if (entryEl.classList.contains('swipeable-entry--swiped')) return;
        if (e.target.closest && e.target.closest('.swipe-delete-btn')) return;
        var entryId = entryEl.getAttribute('data-entry-id');
        if (!entryId) return;
        _enterEditMode(entryId);
      });
      _recentListClickBound = true;
    }

    /**
     * Populates the history filter dropdown with the available month options
     * (Alle / Aktueller Monat / Letzter Monat plus the last 12 months that
     * actually contain entries). Preserves the current selection where possible.
     */
    function _populateHistoryFilter() {
      var filter = document.getElementById('entry-history-filter');
      if (!filter) return;

      // Preserve current selection
      var currentValue = filter.value || _historyFilter || 'current_month';

      // Get all unique YYYY-MM from existing workdays
      var workdays = AppState.getState().workdays || [];
      var months = {};
      for (var i = 0; i < workdays.length; i++) {
        if (workdays[i].date && workdays[i].date.length >= 7) {
          months[workdays[i].date.substring(0, 7)] = true;
        }
      }
      var sortedMonths = Object.keys(months).sort().reverse();

      var monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
      var now = new Date();
      var currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      var lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var lastYM = lastDate.getFullYear() + '-' + String(lastDate.getMonth() + 1).padStart(2, '0');

      var html = '<option value="all">Alle</option>';
      html += '<option value="current_month">Aktueller Monat</option>';
      html += '<option value="last_month">Letzter Monat</option>';

      for (var m = 0; m < sortedMonths.length; m++) {
        var ym = sortedMonths[m];
        if (ym === currentYM || ym === lastYM) continue; // already covered
        var year = parseInt(ym.substring(0, 4), 10);
        var month = parseInt(ym.substring(5, 7), 10);
        html += '<option value="' + ym + '">' + monthNames[month - 1] + ' ' + year + '</option>';
      }

      filter.innerHTML = html;

      // Restore selection
      if (filter.querySelector('option[value="' + currentValue + '"]')) {
        filter.value = currentValue;
      } else {
        filter.value = 'current_month';
      }
      _historyFilter = filter.value;
    }

    /**
     * Renders the recent entries list, filtered by `_historyFilter`. Shows ALL
     * entries matching the filter (no slice limit) — the list itself is
     * scrollable via CSS max-height so only ~5 rows are visible at once.
     */
    function _renderRecentEntries() {
      var listEl = document.getElementById('entry-recent-list');
      if (!listEl) return;

      var workdays = AppState.getState().workdays;
      if (!workdays || workdays.length === 0) {
        listEl.innerHTML = '<p class="entry-empty-state">Noch keine Einträge vorhanden.</p>';
        return;
      }

      var now = new Date();
      var currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      var lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var lastYM = lastDate.getFullYear() + '-' + String(lastDate.getMonth() + 1).padStart(2, '0');

      var filtered = workdays.filter(function (w) {
        if (!w.date) return false;
        var ym = w.date.substring(0, 7);
        if (_historyFilter === 'all') return true;
        if (_historyFilter === 'current_month') return ym === currentYM;
        if (_historyFilter === 'last_month') return ym === lastYM;
        return ym === _historyFilter; // specific YYYY-MM
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<p class="entry-empty-state">Keine Einträge in diesem Zeitraum.</p>';
        return;
      }

      // Sort by date descending, then by createdAt descending
      var sorted = filtered.slice().sort(function (a, b) {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      // NO slice — show ALL filtered entries (the list scrolls via CSS)
      var jobs = JobManager.getActiveJobs();
      var jobMap = {};
      for (var j = 0; j < jobs.length; j++) {
        jobMap[jobs[j].id] = jobs[j];
      }

      var statusLabels = {
        worked: 'Gearbeitet',
        vacation: 'Urlaub',
        sick: 'Krank',
        not_worked: 'Nicht gearbeitet',
        pending: 'Ausstehend'
      };

      var html = '';
      for (var i = 0; i < sorted.length; i++) {
        var entry = sorted[i];
        var job = jobMap[entry.jobId];
        var jobName = job ? job.employerName : 'Unbekannt';
        var statusLabel = statusLabels[entry.status] || entry.status;

        if (entry.status === 'pending') {
          // Pending future shift — special UI with confirm/decline action buttons.
          // Skip swipe-to-delete and tap-to-edit so the action buttons are the
          // only interaction surface.
          var pendingHoursText = (entry.hours !== null && entry.hours !== undefined && entry.hours !== '') ? entry.hours + ' Std.' : '';
          html += '<div class="entry-recent-item entry-pending" data-entry-id="' + entry.id + '">';
          html += '<div class="entry-recent-info">';
          html += '<span class="entry-recent-date">' + _formatDate(entry.date) + '</span>';
          html += '<span class="entry-recent-meta entry-pending-meta">' + jobName + ' · <span class="entry-pending-badge">AUSSTEHEND</span></span>';
          if (pendingHoursText) html += '<span class="entry-pending-hours">Geplant: ' + pendingHoursText + '</span>';
          html += '</div>';
          html += '<div class="entry-recent-actions entry-pending-actions">';
          html += '<button type="button" class="entry-pending-btn entry-pending-btn--confirm" data-pending-action="confirm" data-entry-id="' + entry.id + '" aria-label="Schicht bestätigen">✓</button>';
          html += '<button type="button" class="entry-pending-btn entry-pending-btn--decline" data-pending-action="decline" data-entry-id="' + entry.id + '" aria-label="Schicht löschen">✕</button>';
          html += '</div>';
          html += '</div>';
        } else {
          var hoursText = (entry.status === 'worked' && entry.hours) ? entry.hours + ' Std.' : statusLabel;

          html += '<div class="entry-recent-item swipeable-entry" data-entry-id="' + entry.id + '">';
          html += '<div class="entry-recent-info">';
          html += '<span class="entry-recent-date">' + _formatDate(entry.date) + '</span>';
          html += '<span class="entry-recent-meta">' + jobName + ' · ' + statusLabel + '</span>';
          html += '</div>';
          html += '<div class="entry-recent-actions">';
          html += '<span class="entry-recent-hours">' + hoursText + '</span>';
          html += '</div>';
          html += '</div>';
        }
      }

      listEl.innerHTML = html;

      // Attach swipe-to-delete handler (idempotent: SwipeHandler.attach replaces handlers)
      if (typeof SwipeHandler !== 'undefined' && SwipeHandler.attach) {
        SwipeHandler.attach('entry-recent-list', function (entryId) {
          if (!entryId) return { success: false };
          var result = TimeTrackerModule.deleteEntry(entryId);
          // Re-render after delete
          setTimeout(function () { _renderRecentEntries(); }, 220);
          return result || { success: true };
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

      // Bind tap-to-edit on recent entries (event delegation, bound once for the
      // lifetime of the app so list re-renders don't accumulate listeners).
      _bindRecentListClickHandler();

      // Bind history filter change
      var historyFilter = document.getElementById('entry-history-filter');
      if (historyFilter) {
        historyFilter.addEventListener('change', function () {
          _historyFilter = historyFilter.value;
          _renderRecentEntries();
        });
      }
      _populateHistoryFilter();

      // Initialize shift templates
      _renderTemplates();
      _bindAddTemplate();

      // Render recent entries
      _renderRecentEntries();

      // Subscribe to events for reactive updates
      EventBus.on('workday:saved', function () {
        if (NavigationController.getActiveView() === 'view-entry') {
          _populateHistoryFilter();
          _renderRecentEntries();
        }
      });
      EventBus.on('workday:deleted', function (data) {
        // If the entry currently being edited was deleted (e.g. via swipe), exit edit mode.
        if (_editingEntryId && data && data.id === _editingEntryId) {
          _exitEditMode();
        }
        if (NavigationController.getActiveView() === 'view-entry') {
          _populateHistoryFilter();
          _renderRecentEntries();
        }
      });
      EventBus.on('navigation:change', function (data) {
        if (data && (data.viewId === 'view-entry' || data.view === 'view-entry')) {
          _populateHistoryFilter();
          _renderRecentEntries();
        } else {
          // Leaving the Eintragen tab while in edit mode? Drop edit mode so the
          // next visit starts with a clean "Neuer Eintrag" form.
          if (_editingEntryId) _exitEditMode();
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
        _populateHistoryFilter();
        _renderRecentEntries();
      });
    }

    // ── Shift Templates ──
    var TEMPLATES_KEY = 'jt_shift_templates';

    function _loadTemplates() {
      var result = LocalStorageManager.load(TEMPLATES_KEY);
      return (result.success && Array.isArray(result.data)) ? result.data : [];
    }

    function _saveTemplates(templates) {
      LocalStorageManager.save(TEMPLATES_KEY, templates);
    }

    function _renderTemplates() {
      var templates = _loadTemplates();
      var card = document.getElementById('entry-templates-card');
      var list = document.getElementById('entry-templates-list');
      if (!card || !list) return;

      // Always show the card (so user can add first template)
      card.style.display = '';

      if (templates.length === 0) {
        list.innerHTML = '<span style="font-size:13px;color:var(--color-text-tertiary);">Noch keine Vorlagen. Erstelle eine mit dem Button unten.</span>';
        return;
      }
      var html = '';
      for (var i = 0; i < templates.length; i++) {
        var t = templates[i];
        html += '<div class="entry-template-chip" data-template-idx="' + i + '">';
        html += '<span>' + t.name + '</span>';
        html += '<button type="button" class="entry-template-delete" data-del-idx="' + i + '" aria-label="Löschen">✕</button>';
        html += '</div>';
      }
      list.innerHTML = html;

      // Bind template clicks — auto-submit for today
      var chips = list.querySelectorAll('.entry-template-chip');
      for (var c = 0; c < chips.length; c++) {
        chips[c].addEventListener('click', function (e) {
          if (e.target.classList.contains('entry-template-delete')) return;
          var idx = parseInt(this.getAttribute('data-template-idx'), 10);
          _applyTemplate(idx);
        });
      }

      // Bind delete buttons
      var delBtns = list.querySelectorAll('.entry-template-delete');
      for (var d = 0; d < delBtns.length; d++) {
        delBtns[d].addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(this.getAttribute('data-del-idx'), 10);
          var tpls = _loadTemplates();
          tpls.splice(idx, 1);
          _saveTemplates(tpls);
          _renderTemplates();
        });
      }
    }

    function _applyTemplate(idx) {
      var templates = _loadTemplates();
      var t = templates[idx];
      if (!t) return;

      var jobSelect = document.getElementById('entry-job');
      var hoursInput = document.getElementById('entry-hours');
      var statusSelect = document.getElementById('entry-status');
      var provisionInput = document.getElementById('entry-provision');
      var tipInput = document.getElementById('entry-tip');
      var dailyRateInput = document.getElementById('entry-daily-rate');
      var dateInput = document.getElementById('entry-date');

      // Always set today's date for auto-submit
      var today = new Date();
      if (dateInput) {
        dateInput.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      }

      if (jobSelect && t.jobId) jobSelect.value = t.jobId;
      if (statusSelect) statusSelect.value = 'worked';
      _updateExtraFields();
      if (hoursInput && t.hours) hoursInput.value = t.hours;
      if (provisionInput && t.provision) provisionInput.value = t.provision;
      if (tipInput && t.tip) tipInput.value = t.tip;
      if (dailyRateInput && t.dailyRate) dailyRateInput.value = t.dailyRate;

      // Auto-submit the form
      var form = document.getElementById('entry-form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    }

    function _bindAddTemplate() {
      var createBtn = document.getElementById('entry-create-template-btn');
      var saveBtn = document.getElementById('entry-save-template-btn');
      var cancelBtn = document.getElementById('entry-cancel-template-btn');
      var submitBtn = document.getElementById('entry-submit-btn');
      var formTitle = document.getElementById('entry-form-title');
      if (!createBtn) return;

      // Enter template mode
      createBtn.addEventListener('click', function () {
        _enterTemplateMode();
      });

      // Save template
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var jobSelect = document.getElementById('entry-job');
          var hoursInput = document.getElementById('entry-hours');
          var provisionInput = document.getElementById('entry-provision');
          var tipInput = document.getElementById('entry-tip');
          var dailyRateInput = document.getElementById('entry-daily-rate');
          var nameInput = document.getElementById('entry-template-name');

          // Validate name
          var name = nameInput ? nameInput.value.trim() : '';
          if (!name) {
            showToast('Bitte einen Namen für die Vorlage eingeben');
            if (nameInput) nameInput.focus();
            return;
          }

          // Validate: at least job must be selected
          if (!jobSelect || !jobSelect.value) {
            showToast('Bitte zuerst einen Job auswählen');
            return;
          }

          var template = {
            name: name,
            jobId: jobSelect.value,
            hours: hoursInput && hoursInput.value ? parseFloat(hoursInput.value) : null,
            provision: provisionInput && provisionInput.value ? parseFloat(provisionInput.value) : null,
            tip: tipInput && tipInput.value ? parseFloat(tipInput.value) : null,
            dailyRate: dailyRateInput && dailyRateInput.value ? parseFloat(dailyRateInput.value) : null
          };

          var templates = _loadTemplates();
          templates.push(template);
          _saveTemplates(templates);
          _renderTemplates();
          _exitTemplateMode();
          showToast('Vorlage "' + name + '" gespeichert ✓');
        });
      }

      // Cancel template mode
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          _exitTemplateMode();
        });
      }
    }

    function _enterTemplateMode() {
      var submitBtn = document.getElementById('entry-submit-btn');
      var saveBtn = document.getElementById('entry-save-template-btn');
      var cancelBtn = document.getElementById('entry-cancel-template-btn');
      var formTitle = document.getElementById('entry-form-title');
      var nameGroup = document.getElementById('entry-template-name-group');
      var dateGroup = document.getElementById('entry-date') ? document.getElementById('entry-date').closest('.form-group') : null;
      var statusGroup = document.getElementById('entry-status') ? document.getElementById('entry-status').closest('.form-group') : null;

      if (formTitle) formTitle.textContent = 'Neue Vorlage erstellen';
      if (submitBtn) submitBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = '';
      if (cancelBtn) cancelBtn.style.display = '';
      if (nameGroup) nameGroup.style.display = '';
      // Hide date and status fields in template mode (not relevant for templates)
      if (dateGroup) dateGroup.style.display = 'none';
      if (statusGroup) statusGroup.style.display = 'none';

      // Reset form fields
      var form = document.getElementById('entry-form');
      if (form) form.reset();
      var nameInput = document.getElementById('entry-template-name');
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      _updateExtraFields();
    }

    function _exitTemplateMode() {
      var submitBtn = document.getElementById('entry-submit-btn');
      var saveBtn = document.getElementById('entry-save-template-btn');
      var cancelBtn = document.getElementById('entry-cancel-template-btn');
      var formTitle = document.getElementById('entry-form-title');
      var nameGroup = document.getElementById('entry-template-name-group');
      var dateGroup = document.getElementById('entry-date') ? document.getElementById('entry-date').closest('.form-group') : null;
      var statusGroup = document.getElementById('entry-status') ? document.getElementById('entry-status').closest('.form-group') : null;

      if (formTitle) formTitle.textContent = 'Neuer Eintrag';
      if (submitBtn) submitBtn.style.display = '';
      if (saveBtn) saveBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (nameGroup) nameGroup.style.display = 'none';
      // Show date and status fields again
      if (dateGroup) dateGroup.style.display = '';
      if (statusGroup) statusGroup.style.display = '';

      // Reset form
      var form = document.getElementById('entry-form');
      if (form) form.reset();
      var nameInput = document.getElementById('entry-template-name');
      if (nameInput) nameInput.value = '';
      // Set today's date
      var dateInput = document.getElementById('entry-date');
      if (dateInput) {
        var today = new Date();
        dateInput.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      }
      _updateExtraFields();
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
    let _showAllTime = false; // false = current billing period, true = all time
    let _showProjected = false; // false = actual (worked only), true = include pending
    let _simHoursDelta = 0; // signed integer; 0 = no simulation
    let _stepperBound = false;
    let _simulatorExpanded = false; // Collapsible simulator panel state
    let _showHeaderBrutto = false; // Toggle: false = Netto-Cashflow, true = Brutto-Einkommen

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
     * Returns true if any job has at least one 'pending' entry within the
     * active billing window (per-job billingMonth in current-period mode,
     * or whole year in all-time mode).
     */
    function _hasAnyPendingInWindow() {
      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth() + 1;
      var day = now.getDate();
      var jobs = AppState.getState().jobs;

      for (var ji = 0; ji < jobs.length; ji++) {
        var job = jobs[ji];
        if (_showAllTime) {
          // Scan whole current year
          for (var m = 1; m <= 12; m++) {
            var entriesY = TimeTrackerModule.getEntriesForMonth(year, m, job.id);
            for (var ei = 0; ei < entriesY.length; ei++) {
              if (entriesY[ei].status === 'pending') return true;
            }
          }
        } else {
          var billingMonth = month;
          var billingYear = year;
          if (job.billingDay && day > job.billingDay) {
            billingMonth++;
            if (billingMonth > 12) { billingMonth = 1; billingYear++; }
          }
          var entries = TimeTrackerModule.getEntriesForMonth(billingYear, billingMonth, job.id);
          for (var ek = 0; ek < entries.length; ek++) {
            if (entries[ek].status === 'pending') return true;
          }
        }
      }
      return false;
    }

    /**
     * Updates the visibility and label of the Tatsächlich/Projiziert toggle
     * based on whether pending entries exist in the active window. Forces
     * _showProjected=false when no pending entries are present.
     */
    function _updateSourceToggleVisibility() {
      var btn = document.getElementById('dashboard-source-toggle');
      var label = document.getElementById('dashboard-source-label');
      var card = document.getElementById('daily-dashboard');
      if (!btn) return;

      var hasPending = _hasAnyPendingInWindow();
      if (!hasPending) {
        _showProjected = false;
        btn.hidden = true;
        if (card) card.classList.remove('is-projected');
      } else {
        btn.hidden = false;
      }

      if (label) {
        label.textContent = _showProjected ? 'Projiziert' : 'Tatsächlich';
      }
      if (card) {
        if (_showProjected) {
          card.classList.add('is-projected');
        } else {
          card.classList.remove('is-projected');
        }
      }
    }

    /**
     * Returns the first job with hourly salary type and a positive default rate.
     * @returns {object|null}
     */
    function _getPrimaryHourlyJob() {
      var jobs = AppState.getState().jobs;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].salaryType === 'hourly' && jobs[i].defaultHourlyRate > 0) {
          return jobs[i];
        }
      }
      return null;
    }

    /**
     * Counts hourly jobs with a positive default rate.
     * @returns {number}
     */
    function _findHourlyJobsCount() {
      var jobs = AppState.getState().jobs;
      var count = 0;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].salaryType === 'hourly' && jobs[i].defaultHourlyRate > 0) count++;
      }
      return count;
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

      // Update period label
      var periodLabel = document.getElementById('dashboard-period-label');
      if (periodLabel) {
        periodLabel.textContent = _showAllTime ? 'Gesamt' : 'Aktueller Monat';
      }

      // Visibility of Tatsächlich/Projiziert toggle (also forces _showProjected=false
      // when there are no pending entries left)
      _updateSourceToggleVisibility();

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

      if (_showAllTime) {
        // All-time mode: use yearly aggregation for current year
        var aggregatedYearly = IncomeEngine.getAggregatedYearly(year, _showProjected);
        totalHours = aggregatedYearly.hours || 0;
        totalBrutto = aggregatedYearly.totalBrutto || 0;
        totalNetto = aggregatedYearly.totalNetto || 0;
        totalTips = aggregatedYearly.totalTips || 0;
        totalProvision = aggregatedYearly.provision || 0;
        totalVacationDays = aggregatedYearly.vacationDays || 0;
        totalSickDays = aggregatedYearly.sickDays || 0;
        nettoAvailable = aggregatedYearly.nettoAvailable !== false;
        perJob = aggregatedYearly.perJob || [];
        var nettoCashflow = totalNetto + totalTips;
        var aggregated = {
          hours: totalHours, brutto: totalBrutto, netto: totalNetto,
          tips: totalTips, provision: totalProvision,
          vacationDays: totalVacationDays, sickDays: totalSickDays,
          totalBrutto: totalBrutto, totalNetto: totalNetto, totalTips: totalTips,
          nettoCashflow: nettoCashflow, nettoAvailable: nettoAvailable, perJob: perJob
        };
        _renderDashboard(aggregated, year, month);
        _renderStepper(aggregated, year, month);
      } else {
        // Current billing period mode (per-job billing day)
        for (var ji = 0; ji < jobs.length; ji++) {
          var job = jobs[ji];
          var billingMonth = month;
          var billingYear = year;
          if (job.billingDay && day > job.billingDay) {
            billingMonth++;
            if (billingMonth > 12) { billingMonth = 1; billingYear++; }
          }
          var brutto = IncomeEngine.calculateMonthlyBrutto(job.id, billingYear, billingMonth, _showProjected);
          var nettoResult = IncomeEngine.calculateMonthlyNetto(job.id, billingYear, billingMonth, _showProjected);
          var tips = IncomeEngine.getTipTotal(job.id, billingYear, billingMonth);
          var provisions = IncomeEngine.getProvisionTotal(job.id, billingYear, billingMonth);

          var entries = TimeTrackerModule.getEntriesForMonth(billingYear, billingMonth, job.id);
          var jobHours = 0, jobVacDays = 0, jobSickDays = 0;
          for (var ei = 0; ei < entries.length; ei++) {
            if ((entries[ei].status === 'worked' || (_showProjected && entries[ei].status === 'pending')) && entries[ei].hours) jobHours += entries[ei].hours;
            else if (entries[ei].status === 'vacation') jobVacDays++;
            else if (entries[ei].status === 'sick') jobSickDays++;
          }

          totalHours += jobHours;
          totalBrutto += brutto;
          totalTips += tips;
          totalProvision += provisions;
          totalVacationDays += jobVacDays;
          totalSickDays += jobSickDays;
          if (nettoResult.available) { totalNetto += nettoResult.netto; } else { nettoAvailable = false; }

          perJob.push({
            jobId: job.id, employerName: job.employerName, type: job.type,
            brutto: brutto, netto: nettoResult.available ? nettoResult.netto : null,
            nettoAvailable: nettoResult.available, tips: tips, provisions: provisions
          });
        }

        var nettoCashflow = totalNetto + totalTips;
        var aggregated = {
          hours: totalHours, brutto: totalBrutto, netto: totalNetto,
          tips: totalTips, provision: totalProvision,
          vacationDays: totalVacationDays, sickDays: totalSickDays,
          totalBrutto: totalBrutto, totalNetto: totalNetto, totalTips: totalTips,
          nettoCashflow: nettoCashflow, nettoAvailable: nettoAvailable, perJob: perJob
        };
        _renderDashboard(aggregated, year, month);
        _renderStepper(aggregated, year, month);
      }
    }

    /**
     * Renders the dashboard DOM with aggregated data.
     */
    function _renderDashboard(aggregated, year, month) {
      var hoursEl = document.getElementById('dashboard-total-hours');
      var bruttoEl = document.getElementById('dashboard-total-brutto');
      var nettoEl = document.getElementById('dashboard-total-netto');
      var tipsEl = document.getElementById('dashboard-total-tips');

      if (hoursEl) hoursEl.textContent = _formatHours(aggregated.hours);
      if (bruttoEl) bruttoEl.textContent = _formatCurrency(aggregated.brutto);
      if (nettoEl) {
        // V3.0: Dynamic Netto/Brutto header balance toggle
        var balanceLabelEl = document.getElementById('dashboard-header-balance-label');
        if (_showHeaderBrutto) {
          nettoEl.textContent = _formatCurrency(aggregated.brutto);
          if (balanceLabelEl) balanceLabelEl.textContent = 'Brutto-Einkommen';
        } else {
          nettoEl.textContent = _formatCurrency(aggregated.nettoCashflow);
          if (balanceLabelEl) balanceLabelEl.textContent = 'Netto-Cashflow';
        }
      }

      if (tipsEl) {
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

      // Dynamic Greeting & Theme Toggle Icon Sync (Rebranding v3.0)
      var profile = AppState.getState().userProfile;
      var name = (profile && (profile.name || profile.username)) ? (profile.name || profile.username) : 'Joel';
      var greetingEl = document.getElementById('header-greeting-title');
      if (greetingEl) {
        var prefix = "Servus";
        var hours = new Date().getHours();
        if (hours >= 5 && hours < 12) {
          prefix = "Guten Morgen";
        } else if (hours >= 12 && hours < 18) {
          prefix = "Guten Tag";
        } else if (hours >= 18 && hours < 23) {
          prefix = "Guten Abend";
        } else {
          prefix = "Gute Nacht";
        }
        greetingEl.textContent = prefix + ' ' + name + '!';
      }
      _updateThemeToggleButtonIcon();

      _updateNettoBreakdown(aggregated, year, month);
      _updateAbsenceRow(aggregated);
      _updateFVWarning(year, month);
      _renderFinancialChart(aggregated);
    }

    /**
     * Renders the Einnahmen-Bericht vertical capsules chart and legend.
     */
    function _renderFinancialChart(aggregated) {
      var chartCard = document.getElementById('dashboard-financial-chart-card');
      var pillsEl = document.getElementById('financial-chart-pills');
      var legendEl = document.getElementById('financial-chart-legend');

      if (!chartCard || !pillsEl || !legendEl) return;

      var perJob = aggregated.perJob || [];
      // Filter out jobs with zero brutto
      var activeJobs = perJob.filter(function (pj) { return pj.brutto > 0; });

      if (activeJobs.length === 0 || aggregated.brutto === 0) {
        chartCard.style.display = 'none';
        return;
      }

      chartCard.style.display = 'block';

      var neonColors = [
        { hex: '#4ecca3', shadow: 'rgba(78, 204, 163, 0.4)' },
        { hex: '#3b82f6', shadow: 'rgba(59, 130, 246, 0.4)' },
        { hex: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.4)' },
        { hex: '#ef4444', shadow: 'rgba(239, 68, 68, 0.4)' },
        { hex: '#a855f7', shadow: 'rgba(168, 85, 247, 0.4)' }
      ];

      var pillsHtml = '';
      var legendHtml = '';

      for (var i = 0; i < activeJobs.length; i++) {
        var pj = activeJobs[i];
        var pct = Math.round((pj.brutto / aggregated.brutto) * 100);
        var color = neonColors[i % neonColors.length];

        // Format value for tooltip
        var shortVal = _formatCurrency(pj.brutto);

        pillsHtml += '<div class="financial-pill-wrapper">';
        pillsHtml += '  <div class="financial-pill-column" style="height: ' + pct + '%; background: ' + color.hex + '; box-shadow: 0 4px 16px ' + color.shadow + ';">';
        pillsHtml += '    <span class="financial-pill-value">' + shortVal + '</span>';
        pillsHtml += '  </div>';
        pillsHtml += '  <span class="financial-pill-percentage">' + pct + '%</span>';
        pillsHtml += '</div>';

        legendHtml += '<div class="financial-legend-item">';
        legendHtml += '  <span class="legend-dot" style="color: ' + color.hex + '; background-color: ' + color.hex + ';"></span>';
        legendHtml += '  <span>' + pj.employerName + ' (' + pct + '%)</span>';
        legendHtml += '</div>';
      }

      pillsEl.innerHTML = pillsHtml;
      legendEl.innerHTML = legendHtml;
    }

    /**
     * Shows/hides the Familienversicherung income limit warning.
     */
    function _updateFVWarning(year, month) {
      var warningEl = document.getElementById('dashboard-fv-warning');
      if (!warningEl) {
        // Create the warning element if it doesn't exist
        var dashboard = document.getElementById('daily-dashboard');
        if (!dashboard) return;
        warningEl = document.createElement('div');
        warningEl.id = 'dashboard-fv-warning';
        warningEl.className = 'dashboard-fv-warning';
        dashboard.appendChild(warningEl);
      }

      var fvStatus = LimitMonitor.checkFamilienversicherungLimit(year, month);
      if (!fvStatus) {
        warningEl.style.display = 'none';
        return;
      }

      warningEl.style.display = '';
      var levelClass = fvStatus.warningLevel === 'critical' ? 'fv-critical' : (fvStatus.warningLevel === 'warning' ? 'fv-warning' : 'fv-safe');
      warningEl.className = 'dashboard-fv-warning ' + levelClass;
      warningEl.innerHTML =
        '<div class="fv-warning-header">' +
        '<span class="fv-warning-icon">' + (fvStatus.warningLevel === 'critical' ? '🚨' : fvStatus.warningLevel === 'warning' ? '⚠️' : '✅') + '</span>' +
        '<span class="fv-warning-title">Familienversicherung</span>' +
        '<span class="fv-warning-badge status-badge ' + fvStatus.warningLevel + '">' + fvStatus.percentage + '%</span>' +
        '</div>' +
        '<span class="fv-warning-detail">' + _formatCurrency(fvStatus.current) + ' / ' + _formatCurrency(fvStatus.limit) + ' Einkommensgrenze</span>';
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
     * Returns the primary simulatable job (prefers hourly with rate > 0, falls back to daily with rate > 0).
     * @returns {object|null}
     */
    function _getPrimarySimulatableJob() {
      var jobs = AppState.getState().jobs;
      if (!jobs || jobs.length === 0) return null;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].salaryType === 'hourly' && jobs[i].defaultHourlyRate > 0) {
          return jobs[i];
        }
      }
      for (var j = 0; j < jobs.length; j++) {
        if (jobs[j].salaryType === 'daily' && jobs[j].defaultDailyRate > 0) {
          return jobs[j];
        }
      }
      return null;
    }

    /**
     * Counts worked/pending days for a job in a specific month.
     * @returns {number}
     */
    function _getWorkedDaysForJob(jobId, year, month) {
      var entries = TimeTrackerModule.getEntriesForMonth(year, month, jobId);
      var count = 0;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].status === 'worked' || (_showProjected && entries[i].status === 'pending')) {
          count++;
        }
      }
      return count;
    }

    /**
     * Renders the Steuer-Simulator panel. Recomputes simulated hours/days,
     * brutto, and netto, and updates the dashboard values.
     */
    /**
     * Renders the Steuer-Simulator panel. Recomputes simulated hours/days,
     * brutto, and netto, and updates the dashboard values.
     */
    function _renderStepper(aggregated, year, month) {
      var simPanel = document.getElementById('dashboard-simulator-panel');
      var hoursLabel = document.getElementById('dashboard-hours-label');
      var hoursEl = document.getElementById('dashboard-total-hours');
      var bruttoEl = document.getElementById('dashboard-total-brutto');
      var nettoEl = document.getElementById('dashboard-total-netto');
      
      var slider = document.getElementById('dashboard-hours-slider');
      var sliderMin = document.getElementById('slider-min-label');
      var sliderMax = document.getElementById('slider-max-label');
      var btnUp = document.getElementById('dashboard-hours-up');
      var btnDown = document.getElementById('dashboard-hours-down');
      var btnReset = document.getElementById('dashboard-hours-reset');
      var simInfo = document.getElementById('dashboard-hours-sim-info');
      var badge = document.getElementById('simulator-delta-badge');
      var badgeVal = document.getElementById('simulator-delta-value');
      var statRoot = document.getElementById('stat-stunden-root');
      
      var compactSummary = document.getElementById('simulator-compact-summary');
      var compDeltaVal = document.getElementById('simulator-compact-delta-val');
      var compDeltaMoney = document.getElementById('simulator-compact-delta-money');

      var primaryJob = _getPrimarySimulatableJob();

      // Hide simulator entirely when there's no simulatable job or in all-time mode
      if (!primaryJob || _showAllTime) {
        _simHoursDelta = 0;
        if (simPanel) simPanel.style.display = 'none';
        if (statRoot) statRoot.classList.remove('is-simulating');
        if (hoursLabel) hoursLabel.textContent = 'Stunden';
        if (hoursEl) hoursEl.textContent = _formatHours(aggregated.hours);
        if (bruttoEl) bruttoEl.textContent = _formatCurrency(aggregated.brutto);
        if (nettoEl) nettoEl.textContent = _formatCurrency(_showHeaderBrutto ? aggregated.brutto : aggregated.nettoCashflow);
        var balanceLabelEl = document.getElementById('dashboard-header-balance-label');
        if (balanceLabelEl) balanceLabelEl.textContent = _showHeaderBrutto ? 'Brutto-Einkommen' : 'Netto-Cashflow';
        return;
      }

      if (simPanel) simPanel.style.display = 'block';

      var isDaily = primaryJob.salaryType === 'daily';
      var baselineVal = 0;
      var unit = '';
      var maxDelta = 0;

      var now = new Date();
      var day = now.getDate();
      var billingYear = year;
      var billingMonth = month;
      if (primaryJob.billingDay && day > primaryJob.billingDay) {
        billingMonth++;
        if (billingMonth > 12) { billingMonth = 1; billingYear++; }
      }

      if (isDaily) {
        baselineVal = _getWorkedDaysForJob(primaryJob.id, billingYear, billingMonth);
        unit = ' Tage';
        var daysInMonth = new Date(billingYear, billingMonth, 0).getDate();
        maxDelta = Math.max(5, daysInMonth - baselineVal);
        
        if (hoursLabel) hoursLabel.textContent = 'Tage';
        if (hoursEl) hoursEl.textContent = String(baselineVal);
      } else {
        baselineVal = aggregated.hours;
        unit = ' Std.';
        maxDelta = Math.max(20, 160 - Math.round(baselineVal));
        
        if (hoursLabel) hoursLabel.textContent = 'Stunden';
        if (hoursEl) hoursEl.textContent = _formatHours(baselineVal);
      }

      // Clamp _simHoursDelta within valid range [0, maxDelta]
      if (_simHoursDelta < 0) _simHoursDelta = 0;
      if (_simHoursDelta > maxDelta) _simHoursDelta = maxDelta;

      // Update range slider constraints
      if (slider) {
        slider.min = '0';
        slider.max = String(maxDelta);
        slider.value = String(_simHoursDelta);
      }
      if (sliderMin) sliderMin.textContent = '0' + unit;
      if (sliderMax) sliderMax.textContent = '+' + maxDelta + unit;

      if (_simHoursDelta === 0) {
        if (statRoot) statRoot.classList.remove('is-simulating');
        if (btnReset) btnReset.classList.remove('visible');
        if (badge) badge.style.display = 'none';
        if (compactSummary) compactSummary.style.display = 'none';
        if (simInfo) {
          simInfo.textContent = 'Simulieren (' + (primaryJob.employerName || '') + ')';
        }
        
        if (hoursEl) hoursEl.textContent = isDaily ? String(baselineVal) : _formatHours(baselineVal);
        if (bruttoEl) bruttoEl.textContent = _formatCurrency(aggregated.brutto);
        if (nettoEl) nettoEl.textContent = _formatCurrency(_showHeaderBrutto ? aggregated.brutto : aggregated.nettoCashflow);
        var balanceLabelElZero = document.getElementById('dashboard-header-balance-label');
        if (balanceLabelElZero) balanceLabelElZero.textContent = _showHeaderBrutto ? 'Brutto-Einkommen' : 'Netto-Cashflow';
        
        _renderSimulatorExpandedState();
        return;
      }

      // Active simulation
      if (statRoot) statRoot.classList.add('is-simulating');
      if (btnReset) btnReset.classList.add('visible');

      var simulatedVal = baselineVal + _simHoursDelta;
      var simulatedBrutto = aggregated.brutto;
      if (isDaily) {
        simulatedBrutto += _simHoursDelta * (primaryJob.defaultDailyRate || 0);
      } else {
        simulatedBrutto += _simHoursDelta * primaryJob.defaultHourlyRate;
      }
      if (simulatedBrutto < 0) simulatedBrutto = 0;

      var simulatedNetto;
      var netRes = null;
      try {
        netRes = IncomeEngine.calculateNetForBrutto(primaryJob.id, simulatedBrutto, year);
      } catch (e) { netRes = null; }
      if (netRes && netRes.available) {
        simulatedNetto = netRes.netto;
      } else if (aggregated.brutto > 0) {
        simulatedNetto = simulatedBrutto * (aggregated.netto / aggregated.brutto);
      } else {
        simulatedNetto = simulatedBrutto * 0.65;
      }

      var simulatedNettoCashflow = simulatedNetto + (aggregated.tips || 0);

      // Write simulated values to DOM
      if (hoursEl) hoursEl.textContent = isDaily ? String(simulatedVal) : _formatHours(simulatedVal);
      if (bruttoEl) bruttoEl.textContent = _formatCurrency(simulatedBrutto);
      if (nettoEl) nettoEl.textContent = _formatCurrency(_showHeaderBrutto ? simulatedBrutto : simulatedNettoCashflow);
      var balanceLabelElSim = document.getElementById('dashboard-header-balance-label');
      if (balanceLabelElSim) balanceLabelElSim.textContent = _showHeaderBrutto ? 'Brutto-Einkommen' : 'Netto-Cashflow';

      // Calculate Netto delta
      var deltaNetto = simulatedNettoCashflow - aggregated.nettoCashflow;

      // Render delta badge
      if (badge && badgeVal) {
        badge.style.display = (_simHoursDelta > 0 && _simulatorExpanded) ? 'inline-flex' : 'none';
        badge.className = 'simulator-delta-badge ' + (deltaNetto >= 0 ? 'badge--positive' : 'badge--negative');
        badgeVal.textContent = (deltaNetto >= 0 ? '+' : '') + _formatCurrency(deltaNetto) + ' Netto';
      }

      // Render compact collapsed summary
      if (compDeltaVal && compDeltaMoney) {
        compDeltaVal.textContent = '+' + _simHoursDelta + (isDaily ? ' Tage' : ' Std.');
        compDeltaMoney.textContent = '( +' + _formatCurrency(deltaNetto) + ' )';
        if (compactSummary) {
          compactSummary.style.display = (_simHoursDelta > 0 && !_simulatorExpanded) ? 'inline-flex' : 'none';
        }
      }

      if (simInfo) {
        simInfo.textContent = '+' + _simHoursDelta + ' ' + (isDaily ? 'Tage' : 'Std.') + ' (' + (primaryJob.employerName || '') + ')';
      }

      _renderSimulatorExpandedState();
    }

    /**
     * Renders the expanded/collapsed state of the simulator panel.
     */
    function _renderSimulatorExpandedState() {
      var panel = document.getElementById('dashboard-simulator-panel');
      var collapsibleContent = document.getElementById('simulator-collapsible-content');
      var arrow = document.querySelector('.simulator-toggle-arrow');
      var compactSummary = document.getElementById('simulator-compact-summary');
      var fullBadge = document.getElementById('simulator-delta-badge');

      if (!panel) return;

      if (_simulatorExpanded) {
        panel.classList.remove('collapsed');
        if (collapsibleContent) collapsibleContent.style.display = 'block';
        if (arrow) arrow.textContent = '▾';
        if (compactSummary) compactSummary.style.display = 'none';
        if (fullBadge && _simHoursDelta > 0) fullBadge.style.display = 'inline-flex';
      } else {
        panel.classList.add('collapsed');
        if (collapsibleContent) collapsibleContent.style.display = 'none';
        if (arrow) arrow.textContent = '▸';
        if (fullBadge) fullBadge.style.display = 'none';
        if (compactSummary) {
          compactSummary.style.display = (_simHoursDelta > 0) ? 'inline-flex' : 'none';
        }
      }
    }

    /**
     * Binds range slider and stepper button click handlers. Idempotent.
     */
    function _bindStepper() {
      if (_stepperBound) return;
      var btnUp = document.getElementById('dashboard-hours-up');
      var btnDown = document.getElementById('dashboard-hours-down');
      var btnReset = document.getElementById('dashboard-hours-reset');
      var slider = document.getElementById('dashboard-hours-slider');
      var toggleHeader = document.getElementById('simulator-toggle-header');
      
      if (!btnUp || !btnDown) return;
      _stepperBound = true;

      if (toggleHeader) {
        toggleHeader.addEventListener('click', function () {
          _simulatorExpanded = !_simulatorExpanded;
          _renderSimulatorExpandedState();
          _triggerMicroHaptic();
        });
      }

      btnUp.addEventListener('click', function (e) {
        e.stopPropagation(); // Prevent toggling the header collapse state
        var primaryJob = _getPrimarySimulatableJob();
        if (!primaryJob) return;
        var isDaily = primaryJob.salaryType === 'daily';
        
        var now = new Date();
        var billingYear = now.getFullYear();
        var billingMonth = now.getMonth() + 1;
        if (primaryJob.billingDay && now.getDate() > primaryJob.billingDay) {
          billingMonth++;
          if (billingMonth > 12) { billingMonth = 1; billingYear++; }
        }

        var baselineVal = 0;
        var maxDelta = 0;
        if (isDaily) {
          baselineVal = _getWorkedDaysForJob(primaryJob.id, billingYear, billingMonth);
          var daysInMonth = new Date(billingYear, billingMonth, 0).getDate();
          maxDelta = Math.max(5, daysInMonth - baselineVal);
        } else {
          // Count active month hours baseline
          var jobs = AppState.getState().jobs;
          var totalHours = 0;
          for (var ji = 0; ji < jobs.length; ji++) {
            var job = jobs[ji];
            var billingM = now.getMonth() + 1;
            var billingY = now.getFullYear();
            if (job.billingDay && now.getDate() > job.billingDay) {
              billingM++;
              if (billingM > 12) { billingM = 1; billingY++; }
            }
            var entries = TimeTrackerModule.getEntriesForMonth(billingY, billingM, job.id);
            for (var ei = 0; ei < entries.length; ei++) {
              if ((entries[ei].status === 'worked' || (_showProjected && entries[ei].status === 'pending')) && entries[ei].hours) {
                totalHours += entries[ei].hours;
              }
            }
          }
          baselineVal = totalHours;
          maxDelta = Math.max(20, 160 - Math.round(baselineVal));
        }

        if (_simHoursDelta < maxDelta) {
          _simHoursDelta += 1;
          _update();
          _triggerMicroHaptic();
        }
      });

      btnDown.addEventListener('click', function (e) {
        e.stopPropagation(); // Prevent toggling the header collapse state
        if (_simHoursDelta > 0) {
          _simHoursDelta -= 1;
          _update();
          _triggerMicroHaptic();
        }
      });

      if (slider) {
        slider.addEventListener('click', function (e) {
          e.stopPropagation(); // Prevent toggling header collapse state
        });
        slider.addEventListener('input', function (e) {
          var val = parseInt(e.target.value, 10) || 0;
          if (_simHoursDelta !== val) {
            _simHoursDelta = val;
            _update();
            _triggerMicroHaptic();
          }
        });
      }

      if (btnReset) {
        btnReset.addEventListener('click', function (e) {
          e.stopPropagation(); // Prevent toggling header collapse state
          if (_simHoursDelta !== 0) {
            _simHoursDelta = 0;
            _update();
            _triggerMicroHaptic();
          }
        });
      }
    }

    function _triggerMicroHaptic() {
      if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.micro) {
        HapticFeedbackService.micro();
      }
    }

    function _updateThemeToggleButtonIcon() {
      var btn = document.getElementById('header-theme-toggle-btn');
      if (!btn) return;
      var current = ThemeManager.getTheme();
      var effective = current;
      if (current === 'system') {
        effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      btn.textContent = effective === 'dark' ? '☀️' : '🌙';
    }


    /**
     * Initializes the module: performs initial calculation and subscribes to
     * income:updated event for reactive updates.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      // Bind period toggle button
      var periodToggle = document.getElementById('dashboard-period-toggle');
      if (periodToggle) {
        periodToggle.addEventListener('click', function () {
          _showAllTime = !_showAllTime;
          // All-time mode disables the stepper — reset any pending simulation
          if (_showAllTime) _simHoursDelta = 0;
          _update();
          // Also re-render job cards to match the period
          if (typeof JobCardRenderer !== 'undefined' && JobCardRenderer.render) {
            JobCardRenderer.render();
          }
        });
      }

      // Bind source toggle (Tatsächlich ↔ Projiziert)
      var sourceToggle = document.getElementById('dashboard-source-toggle');
      if (sourceToggle && !sourceToggle._sourceBound) {
        sourceToggle._sourceBound = true;
        sourceToggle.addEventListener('click', function () {
          _showProjected = !_showProjected;
          _update();
        });
      }

      // Bind stepper buttons (idempotent)
      _bindStepper();

      // Bind dynamic Theme Toggle Button (Rebranding v3.0)
      var themeBtn = document.getElementById('header-theme-toggle-btn');
      if (themeBtn) {
        themeBtn.addEventListener('click', function () {
          var current = ThemeManager.getTheme();
          var effective = current;
          if (current === 'system') {
            effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          }
          var next = effective === 'dark' ? 'light' : 'dark';
          ThemeManager.setTheme(next);
          _updateThemeToggleButtonIcon();
          _triggerMicroHaptic();
        });
      }

      var addShiftBtn = document.getElementById('action-add-shift-btn');
      if (addShiftBtn) {
        addShiftBtn.addEventListener('click', function () {
          NavigationController.switchTo('view-entry');
          _triggerMicroHaptic();
        });
      }

      var simBtn = document.getElementById('action-simulator-btn');
      if (simBtn) {
        simBtn.addEventListener('click', function () {
          _simulatorExpanded = !_simulatorExpanded;
          _renderSimulatorExpandedState();
          _update();
          _triggerMicroHaptic();
        });
      }

      var detailsBtn = document.getElementById('action-details-btn');
      if (detailsBtn) {
        detailsBtn.addEventListener('click', function () {
          var detailsEl = document.getElementById('dashboard-netto-details');
          if (detailsEl) {
            detailsEl.open = !detailsEl.open;
          }
          _triggerMicroHaptic();
        });
      }

      // Initial render
      _update();

      // V3.0: Netto/Brutto header balance card toggle
      var balanceCard = document.querySelector('.header-balance-card');
      if (balanceCard && !balanceCard._balanceBound) {
        balanceCard._balanceBound = true;
        balanceCard.addEventListener('click', function () {
          _showHeaderBrutto = !_showHeaderBrutto;
          _update();
          _triggerMicroHaptic();
        });
      }

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

      // Re-evaluate visibility of the source toggle when entries change
      // (e.g. user confirms a pending shift — toggle should hide if no
      // pending entries remain).
      EventBus.on('workday:saved', function () {
        _update();
      });

      EventBus.on('workday:deleted', function () {
        _update();
      });

      // Also update on data:imported (full reload scenario)
      EventBus.on('data:imported', function () {
        _update();
      });
    }

    return {
      init: init,
      isShowingAllTime: function () { return _showAllTime; },
      isShowingProjected: function () { return _showProjected; },
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
     * If a job is provided and has a billingDay, adjusts the period accordingly.
     * @param {object} [job] - Optional job object with billingDay
     * @returns {{ year: number, month: number }}
     */
    function _getCurrentPeriod(job) {
      var now = new Date();
      var year = now.getFullYear();
      var month = now.getMonth() + 1;
      // If GesamtübersichtModule is in "all time" mode, return null month to signal yearly
      if (typeof GesamtübersichtModule !== 'undefined' && GesamtübersichtModule.isShowingAllTime && GesamtübersichtModule.isShowingAllTime()) {
        return { year: year, month: null, allTime: true };
      }
      if (job && job.billingDay && now.getDate() > job.billingDay) {
        month++;
        if (month > 12) { month = 1; year++; }
      }
      return { year: year, month: month, allTime: false };
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
      var period = _getCurrentPeriod(job);
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
      // Add provision to breakdown if > 0
      if (job.hasProvision) {
        var provBreakdown = IncomeEngine.getProvisionTotal(job.id, year, month);
        if (provBreakdown > 0) {
          html += '<span class="job-card-multiply">+</span>';
          html += '<span class="job-card-rate">' + _formatCurrency(provBreakdown) + ' Prov.</span>';
        }
      }
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
     * Renders all-time (yearly) summary content for a job card.
     * @param {object} job
     * @param {number} year
     * @returns {string} HTML string
     */
    function _renderAllTimeContent(job, year) {
      var brutto = IncomeEngine.calculateYearlyBrutto(job.id, year);
      var nettoResult = IncomeEngine.calculateYearlyNetto(job.id, year);
      var totalHours = 0;
      // Sum hours across all months
      for (var m = 1; m <= 12; m++) {
        totalHours += _getMonthlyHours(job.id, year, m);
      }

      var html = '<div class="job-card-content job-card-alltime">';
      html += '<div class="job-card-stats">';
      html += '<span>' + _formatHours(totalHours) + ' Std. gesamt</span>';
      html += '</div>';
      html += '<div class="job-card-earnings">';
      html += '<div class="job-card-stat"><span class="job-card-stat-label">Brutto</span><span class="job-card-stat-value">' + _formatCurrency(brutto) + '</span></div>';
      if (nettoResult && nettoResult.available) {
        html += '<div class="job-card-stat"><span class="job-card-stat-label">Netto</span><span class="job-card-stat-value accent">' + _formatCurrency(nettoResult.netto) + '</span></div>';
      }
      html += '</div>';

      // Provision/tip totals
      if (job.hasProvision || job.hasTipTracking) {
        html += '<div class="job-card-extras">';
        if (job.hasProvision) {
          html += '<span>Provision: ' + _formatCurrency(IncomeEngine.getProvisionTotal(job.id, year)) + '</span>';
        }
        if (job.hasTipTracking) {
          html += '<span>Trinkgeld: ' + _formatCurrency(IncomeEngine.getTipTotal(job.id, year)) + '</span>';
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
      var period = _getCurrentPeriod(job);
      var year = period.year;
      var month = period.allTime ? (new Date().getMonth() + 1) : period.month;

      // Create card element
      var card = document.createElement('div');
      card.className = 'glass-surface goal-job-card job-card';
      card.id = 'job-card-' + job.id;
      card.setAttribute('data-job-id', job.id);
      card.setAttribute('data-job-type', job.type);

      // 1. Header with avatar
      var avatarHtml = _renderJobAvatar(job);
      var headerHtml = '<div class="goal-job-header">' +
        avatarHtml +
        '<div class="goal-job-header-text">' +
        '  <span class="goal-job-title">' + _escapeHtml(job.employerName) + '</span>' +
        '  <span class="goal-job-badge">' + _escapeHtml(job.type) + '</span>' +
        '</div>' +
        '</div>';

      // 2. Mockup Savings Goal Calculations
      var limit = 0;
      var current = 0;
      var remaining = 0;
      var percentage = 0;
      var warningLevel = 'safe';
      var formattedLimit = '';
      var formattedCurrent = '';
      var formattedRemaining = '';

      if (period.allTime) {
        // Yearly mode
        if (job.type === 'Minijob') {
          limit = RuleConfigEngine.getMinijobLimit(year) * 12;
          current = IncomeEngine.calculateYearlyBrutto(job.id, year);
          remaining = Math.max(0, limit - current);
          percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
          warningLevel = percentage >= 95 ? 'critical' : (percentage >= 80 ? 'warning' : 'safe');
          formattedLimit = _formatCurrency(limit);
          formattedCurrent = _formatCurrency(current);
          formattedRemaining = _formatCurrency(remaining);
        } else if (job.type === 'KFB') {
          limit = 70;
          // Count KFB worked days in year
          for (var m = 1; m <= 12; m++) {
            var entries = TimeTrackerModule.getEntriesForMonth(year, m, job.id);
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].status === 'worked' || entries[i].status === 'pending') {
                current++;
              }
            }
          }
          remaining = Math.max(0, limit - current);
          percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
          warningLevel = percentage >= 95 ? 'critical' : (percentage >= 80 ? 'warning' : 'safe');
          formattedLimit = limit + ' Tage';
          formattedCurrent = current + ' Tage';
          formattedRemaining = remaining + ' Tage';
        } else {
          // Werkstudent, Teilzeit, Vollzeit
          var standardMonthlyHours = 80;
          if (job.standardHoursPerDay && job.standardDaysPerWeek) {
            standardMonthlyHours = job.standardHoursPerDay * job.standardDaysPerWeek * 4.33;
          } else if (job.type === 'Teilzeit' || job.type === 'Vollzeit') {
            standardMonthlyHours = 160;
          }
          limit = Math.round(standardMonthlyHours * 12 * 10) / 10;
          // Sum hours across all months
          for (var m = 1; m <= 12; m++) {
            current += _getMonthlyHours(job.id, year, m);
          }
          current = Math.round(current * 100) / 100;
          remaining = Math.max(0, limit - current);
          percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
          formattedLimit = _formatHours(limit) + ' Std.';
          formattedCurrent = _formatHours(current) + ' Std.';
          formattedRemaining = _formatHours(remaining) + ' Std.';
        }
      } else {
        // Monthly mode
        if (job.type === 'Minijob') {
          limit = RuleConfigEngine.getMinijobLimit(year);
          current = IncomeEngine.calculateMonthlyBrutto(job.id, year, month);
          remaining = Math.max(0, limit - current);
          percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
          warningLevel = percentage >= 95 ? 'critical' : (percentage >= 80 ? 'warning' : 'safe');
          formattedLimit = _formatCurrency(limit);
          formattedCurrent = _formatCurrency(current);
          formattedRemaining = _formatCurrency(remaining);
        } else if (job.type === 'KFB') {
          limit = 70;
          // Worked days in current year (KFB limit is yearly)
          for (var m = 1; m <= 12; m++) {
            var entries = TimeTrackerModule.getEntriesForMonth(year, m, job.id);
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].status === 'worked' || entries[i].status === 'pending') {
                current++;
              }
            }
          }
          remaining = Math.max(0, limit - current);
          percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
          warningLevel = percentage >= 95 ? 'critical' : (percentage >= 80 ? 'warning' : 'safe');
          formattedLimit = limit + ' Tage';
          formattedCurrent = current + ' Tage';
          formattedRemaining = remaining + ' Tage';
        } else {
          // Werkstudent, Teilzeit, Vollzeit
          var standardMonthlyHours = 80;
          if (job.standardHoursPerDay && job.standardDaysPerWeek) {
            standardMonthlyHours = job.standardHoursPerDay * job.standardDaysPerWeek * 4.33;
          } else if (job.type === 'Teilzeit' || job.type === 'Vollzeit') {
            standardMonthlyHours = 160;
          }
          limit = Math.round(standardMonthlyHours * 10) / 10;
          current = _getMonthlyHours(job.id, year, month);
          remaining = Math.max(0, limit - current);
          percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
          formattedLimit = _formatHours(limit) + ' Std.';
          formattedCurrent = _formatHours(current) + ' Std.';
          formattedRemaining = _formatHours(remaining) + ' Std.';
        }
      }

      // 3. Body HTML
      var bodyHtml = '<div class="goal-progress-container">' +
        '  <div class="goal-progress-bar">' +
        '    <div class="goal-progress-fill ' + warningLevel + '" style="width: ' + percentage.toFixed(1) + '%"></div>' +
        '  </div>' +
        '</div>' +
        '<div class="goal-stats-row">' +
        '  <div class="goal-stat-item">' +
        '    <span class="goal-stat-label">LIMIT</span>' +
        '    <span class="goal-stat-val">' + formattedLimit + '</span>' +
        '  </div>' +
        '  <div class="goal-stat-item">' +
        '    <span class="goal-stat-label">AKTUELL</span>' +
        '    <span class="goal-stat-val">' + formattedCurrent + '</span>' +
        '  </div>' +
        '  <div class="goal-stat-item">' +
        '    <span class="goal-stat-label">VERBLEIBEND</span>' +
        '    <span class="goal-stat-val">' + formattedRemaining + '</span>' +
        '  </div>' +
        '</div>';

      // Wrap in collapsible container
      var collapsed = AppState.get('jobCardCollapsed_' + job.id) || false;
      var collapseClass = collapsed ? ' job-card-collapsed' : '';
      card.innerHTML = headerHtml + '<div class="job-card-body' + collapseClass + '">' + bodyHtml + '</div>';
      container.appendChild(card);

      // Make header clickable to toggle collapse
      var header = card.querySelector('.goal-job-header');
      if (header) {
        header.style.cursor = 'pointer';
        header.addEventListener('click', function () {
          var body = card.querySelector('.job-card-body');
          if (body) {
            body.classList.toggle('job-card-collapsed');
            AppState.set('jobCardCollapsed_' + job.id, body.classList.contains('job-card-collapsed'));
          }
        });
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
  // Module-level flags used by lazy-init view registrations below.
  var _dailyViewLoaded = false;
  var _pullRefreshAttached = false;

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

    // Show skeleton briefly while data loads (improves perceived performance)
    if (typeof SkeletonLoader !== 'undefined' && SkeletonLoader.show && !_dailyViewLoaded) {
      SkeletonLoader.show('daily-dashboard', 'dashboard-stats');
    }

    GesamtübersichtModule.init();
    JobCardRenderer.init();

    if (typeof SkeletonLoader !== 'undefined' && SkeletonLoader.hide && !_dailyViewLoaded) {
      SkeletonLoader.hide('daily-dashboard');
      _dailyViewLoaded = true;
    }

    // Apply persisted dashboard widget order
    if (typeof DashboardOrderManager !== 'undefined' && DashboardOrderManager.init) {
      DashboardOrderManager.init();
    }

    // Attach pull-to-refresh to the scrollable content area
    if (typeof PullRefreshHandler !== 'undefined' && PullRefreshHandler.attach && !_pullRefreshAttached) {
      var scrollEl = document.querySelector('#view-daily .scroll-content');
      if (scrollEl) {
        if (!scrollEl.id) scrollEl.id = 'view-daily-scroll';
        PullRefreshHandler.attach(scrollEl.id, function () {
          // Re-render all dashboard data
          return new Promise(function (resolve) {
            try {
              GesamtübersichtModule.init();
              if (JobCardRenderer.render) JobCardRenderer.render();
              if (typeof MinijobForecastWidget !== 'undefined' && MinijobForecastWidget.update) {
                MinijobForecastWidget.update();
              }
              if (typeof SparklineRenderer !== 'undefined' && SparklineRenderer.render) {
                SparklineRenderer.render('tip', 'sparkline-tip-container', 14);
                SparklineRenderer.render('provision', 'sparkline-provision-container', 14);
              }
              setTimeout(resolve, 350);
            } catch (e) {
              resolve();
            }
          });
        });
        _pullRefreshAttached = true;
      }
    }
  });

  // Register settings view initialization with NavigationController (lazy-init)
  NavigationController.registerView('view-settings', function () {
    JobManager.initUI();
    ExportImportModule.init();
    ICSImportModule.init();
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

  // ─── HapticFeedbackService ──────────────────────────────────────────────────
  // Centralized vibration controller that triggers navigator.vibrate() patterns
  // for key user interactions, with a global enable/disable preference.
  // Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
  const HapticFeedbackService = (function () {
    var _enabled = true;
    var _supported = false;
    var _lastMicroTime = 0;

    /**
     * Detect iOS Safari (iPhone / iPad / iPod). iOS does not implement the
     * Vibration API at all — the toggle still exists so the user preference is
     * preserved if/when Apple adds support, but we surface a clearer hint.
     * @returns {boolean}
     */
    function _isIOS() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    /**
     * Initialize: load preference from localStorage, detect support, subscribe to events, bind UI.
     */
    function init() {
      // Detect vibration API support
      _supported = !!(navigator && navigator.vibrate);

      // Load preference from localStorage (default: true)
      var stored = localStorage.getItem('jt_haptic_enabled');
      if (stored !== null) {
        _enabled = stored === 'true';
      } else {
        _enabled = true;
      }

      // Subscribe to EventBus events
      EventBus.on('workday:saved', function () { tap(50); });
      EventBus.on('workday:deleted', function () { doublePulse(); });
      EventBus.on('job:deleted', function () { doublePulse(); });
      EventBus.on('punch:started', function () { tap(50); });
      EventBus.on('punch:ended', function () { tap(50); });
      EventBus.on('tax:slider_changed', function () { micro(10); });

      // Bind haptic-toggle UI element
      var toggle = document.getElementById('haptic-toggle');
      var unsupportedHint = document.getElementById('haptic-unsupported-hint');
      var hapticTestBtn = document.getElementById('haptic-test-btn');

      // On unsupported devices (most importantly iOS Safari, where Apple has
      // intentionally not implemented navigator.vibrate), hide the entire
      // feature instead of showing a "doesn't work" hint. The internal API
      // continues to no-op silently so calling code never breaks.
      if (!_supported) {
        if (toggle) {
          // Walk up to the surrounding .toggle-group so the row disappears
          var group = toggle.closest ? toggle.closest('.toggle-group') : null;
          if (group) group.style.display = 'none';
        }
        if (unsupportedHint) {
          unsupportedHint.style.display = 'none';
        }
        if (hapticTestBtn) {
          hapticTestBtn.style.display = 'none';
        }
        return;
      }

      if (toggle) {
        toggle.checked = _enabled;
        if (unsupportedHint) unsupportedHint.style.display = 'none';
        toggle.addEventListener('change', function () {
          setEnabled(toggle.checked);
        });
      }
    }

    /**
     * Trigger a short vibration (e.g., save action).
     * @param {number} [duration=50] - Vibration duration in ms
     */
    function tap(duration) {
      if (!_enabled || !_supported) return;
      navigator.vibrate(duration || 50);
    }

    /**
     * Trigger a double-pulse vibration (e.g., delete action).
     */
    function doublePulse() {
      if (!_enabled || !_supported) return;
      navigator.vibrate([30, 50, 30]);
    }

    /**
     * Trigger a micro vibration for slider/continuous interactions.
     * Throttled to max 1 per 100ms.
     * @param {number} [duration=10]
     */
    function micro(duration) {
      if (!_enabled || !_supported) return;
      var now = Date.now();
      if (now - _lastMicroTime < 100) return;
      _lastMicroTime = now;
      navigator.vibrate(duration || 10);
    }

    /**
     * Check if haptic feedback is supported on this device.
     * @returns {boolean}
     */
    function isSupported() {
      return !!(navigator && navigator.vibrate);
    }

    /**
     * Enable or disable haptic feedback globally.
     * @param {boolean} enabled
     */
    function setEnabled(enabled) {
      _enabled = !!enabled;
      localStorage.setItem('jt_haptic_enabled', String(_enabled));
      // Sync toggle UI if it exists
      var toggle = document.getElementById('haptic-toggle');
      if (toggle && toggle.checked !== _enabled) {
        toggle.checked = _enabled;
      }
    }

    /**
     * Get current enabled state.
     * @returns {boolean}
     */
    function isEnabled() {
      return _enabled;
    }

    return {
      init: init,
      tap: tap,
      doublePulse: doublePulse,
      micro: micro,
      isSupported: isSupported,
      setEnabled: setEnabled,
      isEnabled: isEnabled
    };
  })();

  // ─── SkeletonLoader ─────────────────────────────────────────────────────────
  // Displays pulsing placeholder elements during data loading, ensuring a
  // minimum 300ms display time to avoid flicker.
  // Requirements: 9.1, 9.2, 9.3, 9.9
  const SkeletonLoader = (function () {
    var _activeSkeletons = {};
    var MIN_DISPLAY_MS = 300;

    // Skeleton HTML templates for different content areas
    var TEMPLATES = {
      'dashboard-stats': '<div class="skeleton-container"><div class="skeleton-row">' +
        '<div class="skeleton-box skeleton-stat"></div>' +
        '<div class="skeleton-box skeleton-stat"></div>' +
        '<div class="skeleton-box skeleton-stat"></div>' +
        '</div></div>',
      'job-cards': '<div class="skeleton-container">' +
        '<div class="skeleton-box skeleton-card"></div>' +
        '<div class="skeleton-box skeleton-card"></div>' +
        '</div>',
      'entry-list': '<div class="skeleton-container">' +
        '<div class="skeleton-box skeleton-list-item"></div>' +
        '<div class="skeleton-box skeleton-list-item"></div>' +
        '<div class="skeleton-box skeleton-list-item"></div>' +
        '<div class="skeleton-box skeleton-list-item"></div>' +
        '<div class="skeleton-box skeleton-list-item"></div>' +
        '</div>'
    };

    /**
     * Initialize the SkeletonLoader module.
     */
    function init() {
      // No initialization needed beyond template registration
    }

    /**
     * Show skeleton placeholders in a container.
     * @param {string} containerId - Target container DOM ID
     * @param {string} template - Template name: 'dashboard-stats', 'job-cards', 'entry-list'
     */
    function show(containerId, template) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var html = TEMPLATES[template];
      if (!html) return;

      // Hide existing content
      var children = container.children;
      for (var i = 0; i < children.length; i++) {
        if (!children[i].classList.contains('skeleton-container')) {
          children[i].style.display = 'none';
        }
      }

      // Inject skeleton HTML
      var skeletonEl = document.createElement('div');
      skeletonEl.innerHTML = html;
      var skeletonContainer = skeletonEl.firstChild;
      container.appendChild(skeletonContainer);

      // Set aria-busy for accessibility
      container.setAttribute('aria-busy', 'true');

      // Track active skeleton
      _activeSkeletons[containerId] = {
        startTime: Date.now(),
        template: template
      };
    }

    /**
     * Hide skeleton and reveal actual content with fade-in.
     * Enforces minimum 300ms display time.
     * @param {string} containerId
     */
    function hide(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var skeleton = _activeSkeletons[containerId];
      if (!skeleton) return;

      var elapsed = Date.now() - skeleton.startTime;
      var remaining = MIN_DISPLAY_MS - elapsed;

      if (remaining > 0) {
        // Enforce minimum display time
        setTimeout(function () {
          _performHide(containerId, container);
        }, remaining);
      } else {
        _performHide(containerId, container);
      }
    }

    /**
     * Internal: perform the actual hide transition.
     * @param {string} containerId
     * @param {HTMLElement} container
     */
    function _performHide(containerId, container) {
      var skeletonContainer = container.querySelector('.skeleton-container');
      if (skeletonContainer) {
        // Add hiding class for fade-out
        skeletonContainer.classList.add('skeleton-container--hiding');

        // After 150ms, remove skeleton and fade in content
        setTimeout(function () {
          if (skeletonContainer.parentNode) {
            skeletonContainer.parentNode.removeChild(skeletonContainer);
          }

          // Show and fade in content
          var children = container.children;
          for (var i = 0; i < children.length; i++) {
            if (!children[i].classList.contains('skeleton-container')) {
              children[i].style.display = '';
              children[i].classList.add('skeleton-fade-in');
            }
          }

          // Set aria-busy to false
          container.setAttribute('aria-busy', 'false');

          // Clean up tracking
          delete _activeSkeletons[containerId];
        }, 150);
      } else {
        // No skeleton element found, just clean up
        container.setAttribute('aria-busy', 'false');
        delete _activeSkeletons[containerId];
      }
    }

    /**
     * Check if a skeleton is currently showing in a container.
     * @param {string} containerId
     * @returns {boolean}
     */
    function isShowing(containerId) {
      return !!_activeSkeletons[containerId];
    }

    return {
      init: init,
      show: show,
      hide: hide,
      isShowing: isShowing
    };
  })();

  // ─── PullRefreshHandler ──────────────────────────────────────────────────────
  // iOS-style pull-to-refresh with circular spinner. Detects pull-down gesture
  // on scrollable lists and triggers data reload with visual feedback.
  // Disabled during DashboardOrderManager edit mode.
  // Requirements: 9.4, 9.5, 9.6, 9.7, 9.8
  const PullRefreshHandler = (function () {
    var _pulling = false;
    var _atTop = false;        // Whether the touch started while scroll was at top
    var _startY = 0;
    var _pullDistance = 0;
    var _threshold = 80;       // px to trigger refresh
    var _containers = {};      // { containerId: { onRefresh, indicator, listeners } }
    var _refreshing = false;   // Whether a refresh is currently in progress
    var _rafId = null;         // requestAnimationFrame ID for throttling

    /**
     * Returns true if the page (or its scroll container) is at the very top.
     * Checks both the supplied container and the document/body scroll
     * (because some views rely on body scroll rather than container scroll).
     */
    function _isAtTop(container) {
      if (container && container.scrollTop > 0) return false;
      var docScroll = window.pageYOffset
        || document.documentElement.scrollTop
        || document.body.scrollTop
        || 0;
      return docScroll <= 0;
    }

    /**
     * Initialize the PullRefreshHandler module.
     */
    function init() {
      // Module is ready; containers are attached via attach()
    }

    /**
     * Attach pull-to-refresh to a specific scrollable container.
     * @param {string} containerId - DOM ID of scrollable element
     * @param {Function} onRefresh - Async callback that performs the reload
     */
    function attach(containerId, onRefresh) {
      var container = document.getElementById(containerId);
      if (!container) return;

      // Idempotent: detach existing handlers first
      if (_containers[containerId]) {
        detach(containerId);
      }

      // Get or create indicator
      var indicator = document.getElementById('pull-refresh-indicator');

      var listeners = {
        touchstart: function (e) { _onTouchStart(e, containerId); },
        touchmove: function (e) { _onTouchMove(e, containerId); },
        touchend: function (e) { _onTouchEnd(e, containerId); }
      };

      container.addEventListener('touchstart', listeners.touchstart, { passive: true });
      container.addEventListener('touchmove', listeners.touchmove, { passive: false });
      container.addEventListener('touchend', listeners.touchend, { passive: true });

      _containers[containerId] = {
        onRefresh: onRefresh,
        indicator: indicator,
        listeners: listeners,
        container: container
      };
    }

    /**
     * Detach pull-to-refresh from a container.
     * @param {string} containerId
     */
    function detach(containerId) {
      var config = _containers[containerId];
      if (!config) return;

      var container = config.container;
      container.removeEventListener('touchstart', config.listeners.touchstart);
      container.removeEventListener('touchmove', config.listeners.touchmove);
      container.removeEventListener('touchend', config.listeners.touchend);

      delete _containers[containerId];
    }

    /**
     * Handle touch start event.
     *
     * Pull-to-refresh ONLY activates when the user is at the very top of the
     * scroll context AND continues pulling DOWN. If the touch starts while
     * the user is mid-scroll (scrollTop > 0 OR window scroll > 0), we
     * completely ignore this touch — native scroll handles it.
     */
    function _onTouchStart(e, containerId) {
      if (_refreshing) return;

      // Disable during edit mode
      if (typeof DashboardOrderManager !== 'undefined' && DashboardOrderManager.isEditMode && DashboardOrderManager.isEditMode()) return;

      var config = _containers[containerId];
      if (!config) return;

      var container = config.container;

      // Only activate when scrolled to top of BOTH the container AND the page.
      if (!_isAtTop(container)) {
        _atTop = false;
        _pulling = false;
        return;
      }

      _atTop = true;
      _startY = e.touches[0].clientY;
      _pulling = false; // becomes true only after a downward delta in touchmove
      _pullDistance = 0;
    }

    /**
     * Handle touch move event — iOS-style progressive spinner reveal.
     *
     * If the touch started mid-scroll, do nothing (let the native scroll
     * handle it). If the touch started at the top, only activate the pull
     * indicator once the user pulls DOWN. Upward movement (deltaY <= 0) is
     * a no-op so users can still scroll up the page normally.
     */
    function _onTouchMove(e, containerId) {
      if (_refreshing) return;
      if (!_atTop) return;

      // Disable during edit mode
      if (typeof DashboardOrderManager !== 'undefined' && DashboardOrderManager.isEditMode && DashboardOrderManager.isEditMode()) {
        _atTop = false;
        _pulling = false;
        return;
      }

      var config = _containers[containerId];
      if (!config) return;

      var container = config.container;

      // If the user managed to scroll while the touch is active (e.g. an
      // ancestor container scrolled), bail out so we don't fight native scroll.
      if (!_isAtTop(container)) {
        _atTop = false;
        _pulling = false;
        _resetSpinner(config);
        return;
      }

      var currentY = e.touches[0].clientY;
      var deltaY = currentY - _startY;

      // Upward movement: not a pull. Let native scroll handle it.
      if (deltaY <= 0) {
        // If we had previously activated, reset.
        if (_pulling) {
          _pulling = false;
          _resetSpinner(config);
        }
        return;
      }

      // Downward pull from the top — this is our gesture.
      _pulling = true;
      _pullDistance = deltaY;
      e.preventDefault();

      // Update spinner position/scale/opacity proportional to pull distance
      if (_rafId) cancelAnimationFrame(_rafId);
      _rafId = requestAnimationFrame(function () {
        _updateSpinner(config, _pullDistance);
      });
    }

    /**
     * Update spinner visual state based on pull distance.
     */
    function _updateSpinner(config, distance) {
      var indicator = config.indicator;
      if (!indicator) return;

      var progress = Math.min(distance / _threshold, 1); // 0 to 1
      var scale = 0.5 + progress * 0.5; // 0.5 to 1.0
      var translateY = Math.min(distance * 0.5, 50) - 40; // slides down from -40px
      var rotation = progress * 270; // rotate proportional to pull

      indicator.style.opacity = progress;
      indicator.style.transform = 'translateX(-50%) translateY(' + translateY + 'px) scale(' + scale + ')';
      indicator.classList.add('pull-spinner--pulling');
      indicator.classList.remove('pull-spinner--refreshing');
      indicator.classList.remove('pull-spinner--done');

      // Rotate the SVG circle proportional to pull
      var svg = indicator.querySelector('.pull-spinner__svg');
      if (svg) {
        svg.style.transform = 'rotate(' + rotation + 'deg)';
      }
    }

    /**
     * Handle touch end event.
     */
    function _onTouchEnd(e, containerId) {
      if (_refreshing) return;

      var wasPulling = _pulling;
      _pulling = false;
      _atTop = false;

      if (!wasPulling) return;

      var config = _containers[containerId];
      if (!config) return;

      if (_pullDistance >= _threshold) {
        // Trigger refresh — spinner stays visible and spins
        _triggerRefresh(containerId, config);
      } else {
        // Snap back — not enough pull distance
        _resetSpinner(config);
      }

      _pullDistance = 0;
    }

    /**
     * Trigger the refresh process with spinning indicator.
     */
    function _triggerRefresh(containerId, config) {
      _refreshing = true;

      // Show spinning state
      var indicator = config.indicator;
      if (indicator) {
        indicator.style.opacity = 1;
        indicator.style.transform = 'translateX(-50%) translateY(10px) scale(1)';
        indicator.classList.remove('pull-spinner--pulling');
        indicator.classList.add('pull-spinner--refreshing');

        var svg = indicator.querySelector('.pull-spinner__svg');
        if (svg) svg.style.transform = '';
      }

      // Emit refresh:started event
      EventBus.emit('refresh:started');

      // Show skeletons during reload
      if (typeof SkeletonLoader !== 'undefined' && SkeletonLoader.show) {
        SkeletonLoader.show(containerId, 'entry-list');
      }

      // Set up timeout
      var timeoutId = setTimeout(function () {
        _onRefreshComplete(containerId, config);
      }, 10000);

      // Call the onRefresh callback
      try {
        var result = config.onRefresh();

        if (result && typeof result.then === 'function') {
          result.then(function () {
            clearTimeout(timeoutId);
            _onRefreshComplete(containerId, config);
          }).catch(function () {
            clearTimeout(timeoutId);
            _onRefreshComplete(containerId, config);
          });
        } else {
          clearTimeout(timeoutId);
          _onRefreshComplete(containerId, config);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        _onRefreshComplete(containerId, config);
      }
    }

    /**
     * Handle refresh completion — fade spinner out upward.
     */
    function _onRefreshComplete(containerId, config) {
      _refreshing = false;

      // Hide skeletons
      if (typeof SkeletonLoader !== 'undefined' && SkeletonLoader.hide) {
        SkeletonLoader.hide(containerId);
      }

      var indicator = config.indicator;
      if (indicator) {
        indicator.classList.remove('pull-spinner--refreshing');
        indicator.classList.add('pull-spinner--done');
        indicator.style.opacity = 0;
        indicator.style.transform = 'translateX(-50%) translateY(-40px) scale(0.5)';

        setTimeout(function () {
          indicator.classList.remove('pull-spinner--done');
          indicator.classList.remove('pull-spinner--pulling');
        }, 300);
      }

      // Emit refresh:completed event
      EventBus.emit('refresh:completed');
    }

    /**
     * Reset the spinner to its default hidden state.
     */
    function _resetSpinner(config) {
      var indicator = config.indicator;
      if (!indicator) return;

      indicator.style.opacity = 0;
      indicator.style.transform = 'translateX(-50%) translateY(-40px) scale(0.5)';
      indicator.classList.remove('pull-spinner--pulling');
      indicator.classList.remove('pull-spinner--refreshing');
      indicator.classList.remove('pull-spinner--done');

      var svg = indicator.querySelector('.pull-spinner__svg');
      if (svg) svg.style.transform = '';
    }

    return {
      init: init,
      attach: attach,
      detach: detach
    };
  })();

  // ─── SwipeHandler ─────────────────────────────────────────────────────────
  // Detects horizontal swipe gestures on list entries and reveals a delete
  // action button with confirmation flow.
  // Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9
  const SwipeHandler = (function () {
    var _activeEntry = null;   // Currently revealed entry element
    var _startX = 0;           // Touch start X coordinate
    var _startY = 0;           // Touch start Y coordinate
    var _swiping = false;      // Whether a swipe is in progress
    var _threshold = 60;       // Minimum px to trigger reveal
    var _containers = {};      // { containerId: { onDelete, handlers } }

    /**
     * Initialize: subscribe to navigation:change to reset all revealed entries.
     */
    function init() {
      EventBus.on('navigation:change', function () {
        resetAll();
      });
    }

    /**
     * Attach swipe handling to a specific list container.
     * @param {string} containerId - DOM ID of the list container
     * @param {Function} onDelete - Callback receiving entry ID on confirmed delete
     */
    function attach(containerId, onDelete) {
      var container = document.getElementById(containerId);
      if (!container) return;

      // Idempotent: detach existing handlers first
      if (_containers[containerId]) {
        detach(containerId);
      }

      var handlers = {
        touchstart: function (e) { _onTouchStart(e, containerId); },
        touchmove: function (e) { _onTouchMove(e, containerId); },
        touchend: function (e) { _onTouchEnd(e, containerId); }
      };

      container.addEventListener('touchstart', handlers.touchstart, { passive: true });
      container.addEventListener('touchmove', handlers.touchmove, { passive: false });
      container.addEventListener('touchend', handlers.touchend, { passive: true });

      _containers[containerId] = { onDelete: onDelete, handlers: handlers };
    }

    /**
     * Detach swipe handling from a container.
     * @param {string} containerId
     */
    function detach(containerId) {
      var container = document.getElementById(containerId);
      var config = _containers[containerId];
      if (!container || !config) return;

      container.removeEventListener('touchstart', config.handlers.touchstart);
      container.removeEventListener('touchmove', config.handlers.touchmove);
      container.removeEventListener('touchend', config.handlers.touchend);

      delete _containers[containerId];
    }

    /**
     * Reset all revealed entries to their original position.
     */
    function resetAll() {
      if (_activeEntry) {
        _snapBack(_activeEntry);
        _activeEntry = null;
      }
      _swiping = false;
    }

    /**
     * Internal: handle touchstart event.
     */
    function _onTouchStart(e, containerId) {
      if (!e.touches || e.touches.length === 0) return;

      var touch = e.touches[0];
      _startX = touch.clientX;
      _startY = touch.clientY;
      _swiping = false;

      // Find the swipeable entry element
      var target = e.target;
      var entry = _findSwipeableEntry(target);

      // If swiping a different entry, reset the previous one
      if (entry && _activeEntry && _activeEntry !== entry) {
        _snapBack(_activeEntry);
        _activeEntry = null;
      }

      // If starting a fresh swipe on a non-revealed entry, clear any stale
      // inline transform so live finger-tracking starts from 0.
      if (entry && !entry.classList.contains('swipeable-entry--swiped')) {
        entry.style.transform = '';
      }
    }

    /**
     * Internal: handle touchmove event.
     */
    function _onTouchMove(e, containerId) {
      if (!e.touches || e.touches.length === 0) return;

      var touch = e.touches[0];
      // Signed delta: positive = leftward swipe, negative = rightward swipe.
      var deltaX = _startX - touch.clientX;
      var absX = Math.abs(deltaX);
      var deltaY = Math.abs(touch.clientY - _startY);

      // Activate horizontal swipe in either direction once it dominates over
      // vertical movement. This is the fix for "can't swipe right to close":
      // previously only deltaX > 10 (left only) flipped _swiping to true, so
      // _onTouchEnd bailed out for any rightward swipe.
      if (absX > 10 && absX > deltaY) {
        _swiping = true;
        // Prevent vertical scrolling while a horizontal swipe is locked in.
        e.preventDefault();

        // Live finger-tracking ONLY while opening (left swipe on a non-revealed
        // entry). When closing (right swipe on a revealed entry), we deliberately
        // skip the live transform — letting the CSS transition handle the snap
        // on touchend gives a smooth single animation instead of fighting an
        // inline transform vs the class-applied one.
        var entry = _findSwipeableEntry(e.target);
        if (entry && !entry.classList.contains('swipeable-entry--swiped')) {
          // Opening (left-swipe). Track only leftward motion.
          if (deltaX > 0) {
            // Cap at the delete-button width (-80px) plus a tiny rubber band.
            var capped = Math.min(deltaX, 88);
            entry.style.transform = 'translateX(' + (-capped) + 'px)';
          }
        }
      }
    }

    /**
     * Internal: handle touchend event.
     */
    function _onTouchEnd(e, containerId) {
      if (!_swiping) return;

      var touch = e.changedTouches[0];
      var deltaX = _startX - touch.clientX; // positive = swipe-left, negative = swipe-right

      // Find the swipeable entry element
      var target = e.target;
      var entry = _findSwipeableEntry(target);
      if (!entry) {
        _swiping = false;
        return;
      }

      var isRevealed = entry.classList.contains('swipeable-entry--swiped');

      if (isRevealed) {
        // Already revealed: a meaningful right-swipe closes it.
        if (deltaX <= -(_threshold / 2)) {
          _snapBack(entry);
          if (_activeEntry === entry) _activeEntry = null;
        } else if (deltaX >= _threshold) {
          // Further left swipe — keep revealed (already is)
          // No-op
        } else {
          // Tiny movement — keep current state (revealed).
        }
      } else {
        // Not revealed: a left-swipe past the threshold reveals it.
        if (deltaX >= _threshold) {
          _revealDeleteButton(entry, containerId);
        } else {
          // Snap back to clear any partial offset/state.
          _snapBack(entry);
        }
      }

      _swiping = false;
    }

    /**
     * Internal: find the closest .swipeable-entry ancestor.
     */
    function _findSwipeableEntry(el) {
      while (el && el !== document.body) {
        if (el.classList && el.classList.contains('swipeable-entry')) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    /**
     * Internal: reveal the delete button on an entry.
     */
    function _revealDeleteButton(entry, containerId) {
      // If there's already a delete button, don't add another
      if (entry.querySelector('.swipe-delete-btn')) {
        // Clear any in-flight live-transform so the CSS class governs position
        entry.style.transform = '';
        entry.classList.add('swipeable-entry--swiped');
        _activeEntry = entry;
        return;
      }

      var entryId = entry.getAttribute('data-entry-id') || entry.getAttribute('data-id') || '';

      // Inject delete button HTML
      var deleteBtn = document.createElement('div');
      deleteBtn.className = 'swipe-delete-btn';
      deleteBtn.setAttribute('data-entry-id', entryId);
      deleteBtn.setAttribute('role', 'button');
      deleteBtn.setAttribute('aria-label', 'Eintrag löschen');
      deleteBtn.innerHTML = '<span>🗑️</span><span>Löschen</span>';

      entry.style.position = 'relative';
      entry.appendChild(deleteBtn);

      // Clear the live finger-tracking transform first, then apply the class.
      // The CSS transition handles the snap to translateX(-80px).
      entry.style.transform = '';
      entry.classList.add('swipeable-entry--swiped');
      _activeEntry = entry;

      // Bind delete button tap
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _showConfirmDialog(entryId, entry, containerId);
      });

      // Bind tap elsewhere to snap back
      var _outsideHandler = function (e) {
        if (!entry.contains(e.target)) {
          _snapBack(entry);
          _activeEntry = null;
          document.removeEventListener('click', _outsideHandler);
        }
      };
      setTimeout(function () {
        document.addEventListener('click', _outsideHandler);
      }, 50);
    }

    /**
     * Internal: snap an entry back to its original position.
     *
     * Critical for smooth animation:
     *  1. Remove the inline `style.transform` so the CSS transition (defined
     *     on `.swipeable-entry`) animates from the current position back to 0.
     *  2. Remove the `--swiped` class. With the inline style cleared, the
     *     transition runs cleanly without two transforms fighting each other.
     *  3. Remove the injected `.swipe-delete-btn` AFTER the snap-back animation
     *     completes so the entry is fully reset. We use a one-shot
     *     `transitionend` listener with a setTimeout fallback.
     */
    function _snapBack(entry) {
      if (!entry) return;

      var deleteBtn = entry.querySelector('.swipe-delete-btn');
      var hadSwiped = entry.classList.contains('swipeable-entry--swiped');

      // Clear the inline transform first — without this, the CSS class change
      // is overridden by the inline style and nothing animates.
      entry.style.transform = '';
      entry.classList.remove('swipeable-entry--swiped');

      var cleanedUp = false;
      var cleanup = function () {
        if (cleanedUp) return;
        cleanedUp = true;
        entry.removeEventListener('transitionend', onEnd);
        if (deleteBtn && deleteBtn.parentNode) {
          deleteBtn.parentNode.removeChild(deleteBtn);
        }
      };
      var onEnd = function (e) {
        if (e && e.target !== entry) return;
        if (e && e.propertyName && e.propertyName !== 'transform') return;
        cleanup();
      };

      if (hadSwiped) {
        entry.addEventListener('transitionend', onEnd);
        // Fallback in case transitionend doesn't fire (matches transition duration)
        setTimeout(cleanup, 240);
      } else {
        // Wasn't actually revealed — just clean up the button if present.
        cleanup();
      }
    }

    /**
     * Internal: show confirmation dialog.
     */
    function _showConfirmDialog(entryId, entry, containerId) {
      // Create confirmation dialog overlay
      var dialog = document.createElement('div');
      dialog.className = 'swipe-confirm-dialog';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-label', 'Löschbestätigung');
      dialog.innerHTML =
        '<div class="swipe-confirm-dialog__box">' +
          '<p>Eintrag wirklich löschen?</p>' +
          '<button class="swipe-confirm-dialog__confirm" type="button">Löschen</button>' +
          '<button class="swipe-confirm-dialog__cancel" type="button">Abbrechen</button>' +
        '</div>';

      document.body.appendChild(dialog);

      var confirmBtn = dialog.querySelector('.swipe-confirm-dialog__confirm');
      var cancelBtn = dialog.querySelector('.swipe-confirm-dialog__cancel');

      confirmBtn.addEventListener('click', function () {
        _handleConfirmDelete(entryId, entry, containerId, dialog);
      });

      cancelBtn.addEventListener('click', function () {
        _dismissDialog(dialog);
        _snapBack(entry);
        _activeEntry = null;
      });

      // Tap on overlay background to cancel
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) {
          _dismissDialog(dialog);
          _snapBack(entry);
          _activeEntry = null;
        }
      });
    }

    /**
     * Internal: handle confirmed deletion.
     */
    function _handleConfirmDelete(entryId, entry, containerId, dialog) {
      _dismissDialog(dialog);

      var config = _containers[containerId];
      if (!config || !config.onDelete) return;

      // Call the onDelete callback
      var result = config.onDelete(entryId);

      // Handle promise-based or synchronous result
      if (result && typeof result.then === 'function') {
        result.then(function (res) {
          if (res && res.success === false) {
            _handleDeleteFailure(entry);
          } else {
            _handleDeleteSuccess(entry, entryId);
          }
        }).catch(function () {
          _handleDeleteFailure(entry);
        });
      } else if (result && result.success === false) {
        _handleDeleteFailure(entry);
      } else {
        _handleDeleteSuccess(entry, entryId);
      }
    }

    /**
     * Internal: handle successful deletion with collapse animation.
     */
    function _handleDeleteSuccess(entry, entryId) {
      // Animate collapse (200ms)
      entry.classList.add('swipeable-entry--collapsing');

      // Trigger haptic feedback
      HapticFeedbackService.doublePulse();

      // Emit event
      EventBus.emit('swipe:delete_confirmed', { entryId: entryId });

      // Remove entry after animation
      setTimeout(function () {
        if (entry.parentNode) {
          entry.parentNode.removeChild(entry);
        }
      }, 200);

      _activeEntry = null;
    }

    /**
     * Internal: handle deletion failure.
     */
    function _handleDeleteFailure(entry) {
      // Restore entry position
      _snapBack(entry);
      _activeEntry = null;

      // Show error toast
      showToast('Löschen fehlgeschlagen. Bitte erneut versuchen.', 4000);
    }

    /**
     * Internal: dismiss the confirmation dialog.
     */
    function _dismissDialog(dialog) {
      if (dialog && dialog.parentNode) {
        dialog.parentNode.removeChild(dialog);
      }
    }

    return {
      init: init,
      attach: attach,
      detach: detach,
      resetAll: resetAll
    };
  })();

  // ─── SparklineRenderer ────────────────────────────────────────────────────────
  // Renders inline SVG sparkline charts next to tip and provision totals on the
  // Dashboard, showing 14-day or 30-day trends.
  // Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
  const SparklineRenderer = (function () {
    var _windows = { tip: 14, provision: 14 };

    // SVG dimensions
    var SVG_WIDTH = 80;
    var SVG_HEIGHT = 24;

    // Minimum data points required to show sparkline
    var MIN_DATA_POINTS = 3;

    /**
     * Initialize the module: subscribe to events, render initial sparklines.
     */
    function init() {
      // Subscribe to events that require re-rendering
      EventBus.on('earnings:saved', function () {
        _renderAll();
      });
      EventBus.on('earnings:deleted', function () {
        _renderAll();
      });
      EventBus.on('income:updated', function () {
        _renderAll();
      });
      EventBus.on('workday:saved', function () {
        _renderAll();
      });
      EventBus.on('workday:deleted', function () {
        _renderAll();
      });
      EventBus.on('navigation:change', function (data) {
        if (data && (data.viewId === 'view-daily' || data.view === 'view-daily')) {
          _renderAll();
        }
      });
      EventBus.on('data:imported', function () {
        _renderAll();
      });

      // Initial render — defer one tick so containers exist
      setTimeout(function () { _renderAll(); }, 0);
    }

    /**
     * Render both sparklines (tip and provision).
     */
    function _renderAll() {
      render('tip', 'sparkline-tip-container', _windows.tip);
      render('provision', 'sparkline-provision-container', _windows.provision);
    }

    /**
     * Render a sparkline for a specific data type.
     * @param {string} type - 'tip' or 'provision'
     * @param {string} containerId - DOM element ID to render into
     * @param {number} [windowDays=14] - Time window (14 or 30)
     */
    function render(type, containerId, windowDays) {
      var container = document.getElementById(containerId);
      if (!container) return;

      windowDays = windowDays || 14;

      // Get aggregated data points
      var dataPoints = _getDataPoints(type, windowDays);

      // If fewer than 3 data points, show a tiny placeholder hint
      // (visual feedback that the sparkline area exists and will populate later)
      if (dataPoints.length < MIN_DATA_POINTS) {
        container.innerHTML = '';
        container.classList.add('sparkline-container');
        container.classList.add('sparkline-container--empty');
        container.onclick = null;
        return;
      }
      container.classList.remove('sparkline-container--empty');

      // Generate SVG
      var svg = _generateSVG(dataPoints);

      // Apply container class and click handler
      container.innerHTML = svg;
      container.classList.add('sparkline-container');

      // Attach tap-to-toggle handler
      container.onclick = function () {
        toggleWindow(type);
      };
    }

    /**
     * Get aggregated data points by calendar day within the time window.
     * @param {string} type - 'tip' or 'provision'
     * @param {number} windowDays - Number of days to look back
     * @returns {Array<{date: string, amount: number}>} Sorted by date ascending
     */
    function _getDataPoints(type, windowDays) {
      var jobs = AppState.getState().jobs;
      if (!jobs || jobs.length === 0) return [];

      // Calculate date range
      var now = new Date();
      var endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - windowDays + 1);

      var startStr = _formatDate(startDate);
      var endStr = _formatDate(endDate);

      // Collect all earnings of the given type across all jobs within the window
      var dailyTotals = {};

      for (var j = 0; j < jobs.length; j++) {
        var jobId = jobs[j].id;
        // Get earnings for the current year (and previous year if window spans year boundary)
        var years = [now.getFullYear()];
        if (startDate.getFullYear() !== now.getFullYear()) {
          years.push(startDate.getFullYear());
        }

        for (var yi = 0; yi < years.length; yi++) {
          var entries = EarningsExtraModule.getForJob(jobId, years[yi]);
          for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry.type !== type) continue;
            if (entry.date < startStr || entry.date > endStr) continue;

            if (!dailyTotals[entry.date]) {
              dailyTotals[entry.date] = 0;
            }
            dailyTotals[entry.date] += entry.amount;
          }
        }
      }

      // Convert to sorted array of data points (only days with amounts > 0)
      var result = [];
      var dates = Object.keys(dailyTotals).sort();
      for (var d = 0; d < dates.length; d++) {
        if (dailyTotals[dates[d]] > 0) {
          result.push({ date: dates[d], amount: dailyTotals[dates[d]] });
        }
      }

      return result;
    }

    /**
     * Format a Date object as YYYY-MM-DD string.
     * @param {Date} date
     * @returns {string}
     */
    function _formatDate(date) {
      var y = date.getFullYear();
      var m = String(date.getMonth() + 1).padStart(2, '0');
      var d = String(date.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    /**
     * Generate SVG markup from data points.
     * @param {Array<{date: string, amount: number}>} dataPoints
     * @returns {string} SVG HTML string
     */
    function _generateSVG(dataPoints) {
      if (dataPoints.length === 0) return '';

      var amounts = [];
      for (var i = 0; i < dataPoints.length; i++) {
        amounts.push(dataPoints[i].amount);
      }

      var min = amounts[0];
      var max = amounts[0];
      for (var i = 1; i < amounts.length; i++) {
        if (amounts[i] < min) min = amounts[i];
        if (amounts[i] > max) max = amounts[i];
      }

      // Build path coordinates scaled to SVG dimensions
      var range = max - min;
      var padding = 1; // 1px padding for stroke visibility
      var drawWidth = SVG_WIDTH - (padding * 2);
      var drawHeight = SVG_HEIGHT - (padding * 2);

      var points = [];
      for (var i = 0; i < amounts.length; i++) {
        var x = padding + (amounts.length > 1 ? (i / (amounts.length - 1)) * drawWidth : drawWidth / 2);
        var y;
        if (range === 0) {
          y = padding + drawHeight / 2;
        } else {
          y = padding + drawHeight - ((amounts[i] - min) / range) * drawHeight;
        }
        points.push(x.toFixed(1) + ',' + y.toFixed(1));
      }

      var pathD = 'M' + points.join(' L');

      // Determine color class based on first vs last data point
      var colorClass = _getColorClass(amounts[0], amounts[amounts.length - 1]);

      var svg = '<svg class="sparkline-svg" width="' + SVG_WIDTH + '" height="' + SVG_HEIGHT + '" viewBox="0 0 ' + SVG_WIDTH + ' ' + SVG_HEIGHT + '" xmlns="http://www.w3.org/2000/svg">';
      svg += '<path class="sparkline-path ' + colorClass + '" d="' + pathD + '" />';
      svg += '</svg>';

      return svg;
    }

    /**
     * Determine the color class based on first and last values.
     * @param {number} first - First data point value
     * @param {number} last - Last data point value
     * @returns {string} CSS class name
     */
    function _getColorClass(first, last) {
      if (last > first) return 'sparkline-path--up';
      if (last < first) return 'sparkline-path--down';
      return 'sparkline-path--neutral';
    }

    /**
     * Toggle the time window for a sparkline between 14 and 30 days.
     * @param {string} type - 'tip' or 'provision'
     */
    function toggleWindow(type) {
      if (_windows[type] === 14) {
        _windows[type] = 30;
      } else {
        _windows[type] = 14;
      }

      // Re-render the toggled sparkline
      if (type === 'tip') {
        render('tip', 'sparkline-tip-container', _windows.tip);
      } else if (type === 'provision') {
        render('provision', 'sparkline-provision-container', _windows.provision);
      }
    }

    /**
     * Destroy all rendered sparklines (cleanup).
     */
    function destroy() {
      var tipContainer = document.getElementById('sparkline-tip-container');
      var provContainer = document.getElementById('sparkline-provision-container');

      if (tipContainer) {
        tipContainer.innerHTML = '';
        tipContainer.classList.remove('sparkline-container');
        tipContainer.onclick = null;
      }
      if (provContainer) {
        provContainer.innerHTML = '';
        provContainer.classList.remove('sparkline-container');
        provContainer.onclick = null;
      }

      // Reset windows to default
      _windows = { tip: 14, provision: 14 };
    }

    return { init: init, render: render, toggleWindow: toggleWindow, destroy: destroy };
  })();

  // ─── PunchClock ─────────────────────────────────────────────────────────────────
  // Provides one-tap shift start/stop functionality with a running timer display
  // and automatic quarter-hour rounding.
  // Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
  const PunchClock = (function () {
    var STORAGE_KEY = 'jt_punch_clock';
    var WARNING_THRESHOLD_MS = 16 * 60 * 60 * 1000; // 16 hours
    var EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
    var TIMER_INTERVAL_MS = 1000;
    var RING_CIRC = 2 * Math.PI * 44; // ≈ 276.46 — must match CSS stroke-dasharray

    var _timerInterval = null;
    var _shiftData = null; // { startTime, jobId, warningDismissed }

    /**
     * Initialize: restore active shift from localStorage, bind UI events.
     */
    function init() {
      _restoreShift();

      var centerBtn = document.getElementById('punch-center-btn');
      var warningEndBtn = document.getElementById('punch-warning-end-btn');
      var warningContinueBtn = document.getElementById('punch-warning-continue-btn');

      if (centerBtn && !centerBtn._punchBound) {
        centerBtn._punchBound = true;
        centerBtn.addEventListener('click', function () {
          // Single button toggles between start and end based on shift state
          if (_shiftData) {
            endShift();
          } else {
            startShift();
          }
        });
      }

      if (warningEndBtn && !warningEndBtn._punchBound) {
        warningEndBtn._punchBound = true;
        warningEndBtn.addEventListener('click', function () { endShift(); });
      }

      if (warningContinueBtn && !warningContinueBtn._punchBound) {
        warningContinueBtn._punchBound = true;
        warningContinueBtn.addEventListener('click', function () { dismissWarning(); });
      }

      // Wire skip button — discard active shift
      var skipBtn = document.getElementById('punch-skip-btn');
      if (skipBtn && !skipBtn._punchBound) {
        skipBtn._punchBound = true;
        skipBtn.addEventListener('click', function () {
          _skipShift();
        });
      }

      // Initialize ring to empty
      _setRingProgress(0, false);

      if (_shiftData) {
        _showActiveUI();
        _startTimer();
      } else {
        _showIdleUI();
      }
    }

    /**
     * Start a new shift. Stores timestamp in localStorage.
     */
    function startShift() {
      if (_shiftData) return { success: false };

      var appState = AppState.getAppState();
      var jobId = appState.lastActiveJobId || null;
      if (jobId && !JobManager.getJob(jobId)) jobId = null;
      if (!jobId) {
        var jobs = JobManager.getAllJobs();
        if (jobs.length > 0) jobId = jobs[0].id;
      }

      var startTime = Date.now();
      _shiftData = { startTime: startTime, jobId: jobId, warningDismissed: false };
      _saveShift();

      _showActiveUI();
      _startTimer();

      EventBus.emit('punch:started', { startTime: startTime, jobId: jobId });

      if (HapticFeedbackService && HapticFeedbackService.tap) {
        HapticFeedbackService.tap(50);
      }

      return { success: true, startTime: startTime };
    }

    /**
     * End the active shift. Rounds duration up to the next 0.25h.
     * If the job has tip/provision tracking enabled, shows inline extras form.
     */
    function endShift() {
      if (!_shiftData) return { success: false };

      var now = Date.now();
      var elapsedMs = now - _shiftData.startTime;
      var elapsedHours = elapsedMs / (1000 * 60 * 60);
      var duration = Math.ceil(elapsedHours / 0.25) * 0.25;
      if (duration < 0.25) duration = 0.25;

      var shiftDate = new Date(_shiftData.startTime);
      var dateStr = shiftDate.getFullYear() + '-' +
        String(shiftDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(shiftDate.getDate()).padStart(2, '0');

      var jobId = _shiftData.jobId;

      _stopTimer();
      _shiftData = null;
      _clearStorage();

      _showIdleUI();

      EventBus.emit('punch:ended', { duration: duration, date: dateStr, jobId: jobId });

      if (HapticFeedbackService && HapticFeedbackService.tap) {
        HapticFeedbackService.tap(50);
      }

      // Check if job has tip/provision tracking enabled
      var job = jobId ? JobManager.getJob(jobId) : null;
      var hasTip = job && job.hasTipTracking;
      var hasProvision = job && job.hasProvision;

      if (hasTip || hasProvision) {
        _showExtrasForm(dateStr, duration, jobId, hasTip, hasProvision);
      } else {
        _navigateToEntryForm(dateStr, duration, jobId);
      }

      return { success: true, duration: duration, date: dateStr };
    }

    /**
     * Get current shift status.
     */
    function getStatus() {
      if (!_shiftData) return { active: false };
      var elapsed = Date.now() - _shiftData.startTime;
      return { active: true, startTime: _shiftData.startTime, elapsed: elapsed };
    }

    /**
     * Dismiss the 16-hour warning without ending the shift.
     */
    function dismissWarning() {
      if (!_shiftData) return;
      _shiftData.warningDismissed = true;
      _saveShift();
      var warningBanner = document.getElementById('punch-warning-banner');
      if (warningBanner) warningBanner.style.display = 'none';
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    function _restoreShift() {
      try {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          var parsed = JSON.parse(stored);
          if (parsed && parsed.startTime && typeof parsed.startTime === 'number') {
            _shiftData = {
              startTime: parsed.startTime,
              jobId: parsed.jobId || null,
              warningDismissed: parsed.warningDismissed || false
            };
          }
        }
      } catch (e) {
        _shiftData = null;
      }
    }

    function _saveShift() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_shiftData)); } catch (e) {}
    }

    function _clearStorage() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    /**
     * Skip (discard) the active shift without saving anything.
     */
    function _skipShift() {
      if (!_shiftData) return;
      _stopTimer();
      _shiftData = null;
      _clearStorage();
      _showIdleUI();
      if (typeof ToastModule !== 'undefined' && ToastModule.show) {
        ToastModule.show('Schicht verworfen', 'info');
      }
    }

    function _startTimer() {
      if (_timerInterval) return;
      _updateTimerDisplay();
      _timerInterval = setInterval(function () {
        _updateTimerDisplay();
        _checkWarning();
      }, TIMER_INTERVAL_MS);
    }

    function _stopTimer() {
      if (_timerInterval) {
        clearInterval(_timerInterval);
        _timerInterval = null;
      }
    }

    /**
     * Update the timer display (HH:MM:SS) and the SVG progress ring.
     * After 8h, the ring stays full and switches to the "overtime" warm color.
     * Timer is shown in the label area below the ring (not inside the button).
     */
    function _updateTimerDisplay() {
      if (!_shiftData) return;

      var timerEl = document.getElementById('punch-timer-text');
      var elapsed = Date.now() - _shiftData.startTime;
      var totalSeconds = Math.floor(elapsed / 1000);
      var hours = Math.floor(totalSeconds / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;

      var display = String(hours).padStart(2, '0') + ':' +
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0');

      if (timerEl) timerEl.textContent = display;

      // Ring progress: 0..1 over 8 hours, capped at 1
      var progress = elapsed / EIGHT_HOURS_MS;
      var overtime = false;
      if (progress >= 1) {
        progress = 1;
        overtime = true;
      }
      _setRingProgress(progress, overtime);
    }

    /**
     * Set the SVG progress-ring offset and overtime state.
     * @param {number} progress - 0..1
     * @param {boolean} overtime
     */
    function _setRingProgress(progress, overtime) {
      var ring = document.getElementById('punch-ring-progress');
      if (!ring) return;
      var p = Math.max(0, Math.min(progress, 1));
      ring.style.strokeDashoffset = String(RING_CIRC * (1 - p));
      if (overtime) {
        ring.classList.add('punch-ring__progress--overtime');
      } else {
        ring.classList.remove('punch-ring__progress--overtime');
      }
    }

    function _checkWarning() {
      if (!_shiftData) return;
      if (_shiftData.warningDismissed) return;
      var elapsed = Date.now() - _shiftData.startTime;
      if (elapsed > WARNING_THRESHOLD_MS) _showWarning();
    }

    function _showWarning() {
      var warningBanner = document.getElementById('punch-warning-banner');
      if (warningBanner) warningBanner.style.display = '';
      EventBus.emit('punch:warning', { elapsed: Date.now() - _shiftData.startTime });
    }

    /**
     * Show the active-shift UI: small stop icon in center, timer + "läuft seit"
     * in the bottom area next to the ring.
     */
    function _showActiveUI() {
      var container = document.getElementById('punch-clock-container');
      var iconEl = document.getElementById('punch-center-icon');
      var btn = document.getElementById('punch-center-btn');
      var bottomArea = document.getElementById('punch-bottom-area');
      var skipBtn = document.getElementById('punch-skip-btn');

      if (container) container.classList.add('punch-clock--active');
      if (iconEl) iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
      if (btn) btn.setAttribute('aria-label', 'Schicht beenden');
      if (bottomArea) {
        bottomArea.innerHTML = '<span class="punch-prelabel">läuft seit</span><span class="punch-timer-text" id="punch-timer-text">00:00:00</span>';
      }
      if (skipBtn) skipBtn.style.display = '';
    }

    /**
     * Show the idle UI: play icon, title + subtitle in bottom area.
     */
    function _showIdleUI() {
      var container = document.getElementById('punch-clock-container');
      var iconEl = document.getElementById('punch-center-icon');
      var btn = document.getElementById('punch-center-btn');
      var bottomArea = document.getElementById('punch-bottom-area');
      var warningBanner = document.getElementById('punch-warning-banner');
      var skipBtn = document.getElementById('punch-skip-btn');

      if (container) container.classList.remove('punch-clock--active');
      if (iconEl) iconEl.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      if (btn) btn.setAttribute('aria-label', 'Schicht starten');
      if (bottomArea) bottomArea.innerHTML = '<span class="punch-tile-title">Schicht</span><span class="punch-prelabel">Tippe zum Starten</span>';
      if (warningBanner) warningBanner.style.display = 'none';
      if (skipBtn) skipBtn.style.display = 'none';
      _setRingProgress(0, false);
    }

    /**
     * Show inline extras form (tip/provision) inside the punch clock tile.
     * @param {string} date
     * @param {number} hours
     * @param {string} jobId
     * @param {boolean} hasTip
     * @param {boolean} hasProvision
     */
    function _showExtrasForm(date, hours, jobId, hasTip, hasProvision) {
      var formEl = document.getElementById('punch-extras-form');
      if (!formEl) {
        // Fallback: navigate to entry form
        _navigateToEntryForm(date, hours, jobId);
        return;
      }

      var html = '<p class="punch-extras-form__title">Schicht: ' + hours + 'h ✓</p>';
      if (hasTip) {
        html += '<input type="number" class="punch-extras-form__input" id="punch-tip-input" placeholder="Trinkgeld €" step="0.01" min="0" inputmode="decimal">';
      }
      if (hasProvision) {
        html += '<input type="number" class="punch-extras-form__input" id="punch-provision-input" placeholder="Provision €" step="0.01" min="0" inputmode="decimal">';
      }
      html += '<button type="button" class="punch-extras-form__confirm" id="punch-extras-confirm">✓ Bestätigen</button>';
      html += '<button type="button" class="punch-extras-form__skip" id="punch-extras-skip">Überspringen</button>';

      formEl.innerHTML = html;
      formEl.style.display = '';

      // Bind confirm
      var confirmBtn = document.getElementById('punch-extras-confirm');
      var skipBtn = document.getElementById('punch-extras-skip');

      var onConfirm = function () {
        // Confirm: always save the workday entry, even if tip/provision are empty.
        // Empty fields default to 0€.
        var tipVal = 0;
        var provVal = 0;
        var tipInput = document.getElementById('punch-tip-input');
        var provInput = document.getElementById('punch-provision-input');
        if (tipInput && tipInput.value) tipVal = parseFloat(tipInput.value) || 0;
        if (provInput && provInput.value) provVal = parseFloat(provInput.value) || 0;

        // Save workday entry
        TimeTrackerModule.createEntry({
          jobId: jobId,
          date: date,
          hours: hours,
          status: 'worked'
        });

        // Save extras only when the user actually entered a value > 0
        if (tipVal > 0 && hasTip) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: date,
            type: 'tip',
            amount: tipVal
          });
        }
        if (provVal > 0 && hasProvision) {
          EarningsExtraModule.addEarning({
            jobId: jobId,
            date: date,
            type: 'provision',
            amount: provVal
          });
        }

        // Hide form, reset
        formEl.style.display = 'none';
        formEl.innerHTML = '';

        if (tipVal > 0 || provVal > 0) {
          showToast('Schicht + Extras eingetragen ✓');
        } else {
          showToast('Schicht eingetragen ✓');
        }
      };

      var onSkip = function () {
        // Skip: discard the shift entirely. Don't save the workday entry.
        formEl.style.display = 'none';
        formEl.innerHTML = '';
        showToast('Schicht verworfen');
      };

      if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
      if (skipBtn) skipBtn.addEventListener('click', onSkip);

      // Focus first input
      setTimeout(function () {
        var firstInput = formEl.querySelector('input');
        if (firstInput) firstInput.focus();
      }, 100);
    }

    /**
     * Navigate to the entry form pre-filled with shift data.
     */
    function _navigateToEntryForm(date, hours, jobId) {
      NavigationController.switchTo('view-entry');
      setTimeout(function () {
        var dateInput = document.getElementById('entry-date');
        var hoursInput = document.getElementById('entry-hours');
        var jobSelect = document.getElementById('entry-job');

        if (dateInput) dateInput.value = date;
        if (hoursInput) hoursInput.value = hours;
        if (jobSelect && jobId) {
          jobSelect.value = jobId;
          var changeEvent = new Event('change', { bubbles: true });
          jobSelect.dispatchEvent(changeEvent);
        }
      }, 100);
    }

    return {
      init: init,
      startShift: startShift,
      endShift: endShift,
      getStatus: getStatus,
      dismissWarning: dismissWarning
    };
  })();

  // ─── RuleChecker ──────────────────────────────────────────────────────────────
  // Performs real-time validation of entry form inputs against labor law limits
  // (Werkstudent 20h/week, Minijob 603€/month) and displays non-blocking warning toasts.
  // Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
  const RuleChecker = (function () {
    var _activeWarnings = {};   // { ruleId: { element, timeout, message } }
    var _debounceTimer = null;  // 300ms debounce for input changes
    var _lastCheck = {};        // { ruleId: boolean } to prevent duplicates
    var _warningQueue = [];     // queue for sequential display with 500ms delay
    var _queueTimer = null;     // timer for sequential warning display
    var _active = false;        // whether RuleChecker is active (entry view visible)

    var DEBOUNCE_MS = 300;
    var AUTO_DISMISS_MS = 6000;
    var SEQUENTIAL_DELAY_MS = 500;
    var WERKSTUDENT_WEEKLY_LIMIT = 20;
    var MINIJOB_MONTHLY_LIMIT = 603;

    var RULES = {
      werkstudent_weekly: {
        id: 'werkstudent_weekly',
        message: 'Werkstudentenprivileg: 20h/Woche in der Vorlesungszeit überschritten'
      },
      minijob_monthly: {
        id: 'minijob_monthly',
        message: 'Minijob-Grenze: 603 €/Monat überschritten'
      }
    };

    /**
     * Get the ISO week start (Monday) and end (Sunday) for a given date string.
     * @param {string} dateStr - YYYY-MM-DD
     * @returns {{ start: string, end: string }}
     */
    function _getISOWeekRange(dateStr) {
      var d = new Date(dateStr + 'T12:00:00');
      var day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      // Convert to ISO day: Mon=1, Tue=2, ..., Sun=7
      var isoDay = day === 0 ? 7 : day;
      // Monday of this week
      var monday = new Date(d);
      monday.setDate(d.getDate() - (isoDay - 1));
      // Sunday of this week
      var sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      return {
        start: monday.toISOString().slice(0, 10),
        end: sunday.toISOString().slice(0, 10)
      };
    }

    /**
     * Sum hours for a specific job in a given ISO week range.
     * @param {string} jobId
     * @param {string} weekStart - YYYY-MM-DD (Monday)
     * @param {string} weekEnd - YYYY-MM-DD (Sunday)
     * @returns {number}
     */
    function _sumWeeklyHours(jobId, weekStart, weekEnd) {
      var workdays = AppState.getState().workdays;
      var total = 0;
      for (var i = 0; i < workdays.length; i++) {
        var w = workdays[i];
        if (w.jobId === jobId && w.date >= weekStart && w.date <= weekEnd && w.status === 'worked' && w.hours) {
          total += w.hours;
        }
      }
      return total;
    }

    /**
     * Calculate gross earnings for a Minijob in a given month.
     * @param {string} jobId
     * @param {number} year
     * @param {number} month - 1-12
     * @returns {number}
     */
    function _sumMonthlyGross(jobId, year, month) {
      return IncomeEngine.calculateMonthlyBrutto(jobId, year, month);
    }

    /**
     * Calculate the gross earnings that would result from adding hours to a job.
     * @param {object} job
     * @param {number} hours
     * @returns {number}
     */
    function _calculateAdditionalGross(job, hours) {
      var rate = job.defaultHourlyRate || 0;
      return hours * rate;
    }

    /**
     * Run all applicable rule checks for the current form state.
     * @returns {Array<{ rule: string, message: string, severity: string }>}
     */
    function check() {
      var violations = [];

      var jobSelect = document.getElementById('entry-job');
      var dateInput = document.getElementById('entry-date');
      var hoursInput = document.getElementById('entry-hours');

      if (!jobSelect || !dateInput || !hoursInput) return violations;

      var jobId = jobSelect.value;
      var dateStr = dateInput.value;
      var hours = parseFloat(hoursInput.value);

      if (!jobId || !dateStr) return violations;
      if (isNaN(hours) || hours <= 0) hours = 0;

      var job = JobManager.getJob(jobId);
      if (!job) return violations;

      // ── Werkstudent weekly rule ──
      if (job.type === 'Werkstudent') {
        var weekRange = _getISOWeekRange(dateStr);
        var existingHours = _sumWeeklyHours(jobId, weekRange.start, weekRange.end);
        var totalWeeklyHours = existingHours + hours;

        if (totalWeeklyHours > WERKSTUDENT_WEEKLY_LIMIT) {
          violations.push({
            rule: 'werkstudent_weekly',
            message: RULES.werkstudent_weekly.message,
            severity: 'warning'
          });
        }
      }

      // ── Minijob monthly rule ──
      if (job.type === 'Minijob') {
        var year = parseInt(dateStr.substring(0, 4), 10);
        var month = parseInt(dateStr.substring(5, 7), 10);
        var existingGross = _sumMonthlyGross(jobId, year, month);
        var additionalGross = _calculateAdditionalGross(job, hours);
        var totalMonthlyGross = existingGross + additionalGross;

        if (totalMonthlyGross > MINIJOB_MONTHLY_LIMIT) {
          violations.push({
            rule: 'minijob_monthly',
            message: RULES.minijob_monthly.message,
            severity: 'warning'
          });
        }
      }

      // Process violations: show new warnings, dismiss resolved ones
      _processViolations(violations);

      return violations;
    }

    /**
     * Process violations: show new warnings, dismiss resolved ones.
     * @param {Array} violations
     */
    function _processViolations(violations) {
      var activeRuleIds = {};
      for (var i = 0; i < violations.length; i++) {
        activeRuleIds[violations[i].rule] = violations[i];
      }

      // Dismiss warnings for rules that no longer apply (Req 4.7)
      for (var ruleId in _activeWarnings) {
        if (Object.prototype.hasOwnProperty.call(_activeWarnings, ruleId)) {
          if (!activeRuleIds[ruleId]) {
            _dismissWarningImmediate(ruleId);
          }
        }
      }

      // Show new warnings (Req 4.8: prevent duplicates)
      var newWarnings = [];
      for (var j = 0; j < violations.length; j++) {
        var v = violations[j];
        if (!_activeWarnings[v.rule]) {
          newWarnings.push(v);
        }
      }

      // Show multiple warnings sequentially with 500ms delay (Req 4.5)
      if (newWarnings.length > 0) {
        _queueWarnings(newWarnings);
      }
    }

    /**
     * Queue warnings for sequential display with 500ms delay between them.
     * @param {Array} warnings
     */
    function _queueWarnings(warnings) {
      for (var i = 0; i < warnings.length; i++) {
        _warningQueue.push(warnings[i]);
      }
      _processQueue();
    }

    /**
     * Process the warning queue, showing one at a time with delay.
     */
    function _processQueue() {
      if (_queueTimer) return; // already processing
      if (_warningQueue.length === 0) return;

      var warning = _warningQueue.shift();
      // Double-check it's not already showing (Req 4.8)
      if (_activeWarnings[warning.rule]) {
        // Skip and process next
        if (_warningQueue.length > 0) {
          _queueTimer = setTimeout(function () {
            _queueTimer = null;
            _processQueue();
          }, SEQUENTIAL_DELAY_MS);
        }
        return;
      }

      _showWarning(warning.rule, warning.message);

      // Process next in queue after delay
      if (_warningQueue.length > 0) {
        _queueTimer = setTimeout(function () {
          _queueTimer = null;
          _processQueue();
        }, SEQUENTIAL_DELAY_MS);
      }
    }

    /**
     * Show a warning toast for a specific rule.
     * @param {string} ruleId
     * @param {string} message
     */
    function _showWarning(ruleId, message) {
      // Honor the global rule-warning preference (Settings → Benachrichtigungen)
      try {
        if (typeof NotificationScheduler !== 'undefined' && NotificationScheduler.getPreferences) {
          var prefs = NotificationScheduler.getPreferences();
          if (prefs && prefs.ruleWarning && prefs.ruleWarning.enabled === false) {
            return;
          }
        }
      } catch (e) { /* default to allow */ }

      var container = document.getElementById('rule-warning-container');
      if (!container) return;

      // Create toast element
      var toast = document.createElement('div');
      toast.id = 'rule-warning-' + ruleId;
      toast.className = 'rule-warning-toast rule-warning-toast--enter';
      toast.setAttribute('role', 'alert');
      toast.setAttribute('aria-live', 'assertive');

      var msgSpan = document.createElement('span');
      msgSpan.textContent = message;
      toast.appendChild(msgSpan);

      var dismissBtn = document.createElement('button');
      dismissBtn.className = 'rule-warning-dismiss-btn';
      dismissBtn.setAttribute('aria-label', 'Warnung schließen');
      dismissBtn.textContent = '×';
      dismissBtn.addEventListener('click', function () {
        dismissWarning(ruleId);
      });
      toast.appendChild(dismissBtn);

      // Allow dismiss by tapping the toast itself
      toast.addEventListener('click', function (e) {
        if (e.target !== dismissBtn) {
          dismissWarning(ruleId);
        }
      });

      container.appendChild(toast);

      // Auto-dismiss after 6 seconds (Req 4.4)
      var timeout = setTimeout(function () {
        _dismissWithAnimation(ruleId);
      }, AUTO_DISMISS_MS);

      _activeWarnings[ruleId] = {
        element: toast,
        timeout: timeout,
        message: message
      };

      // Emit event
      EventBus.emit('rule:warning_shown', { ruleId: ruleId, message: message });
    }

    /**
     * Dismiss a specific warning toast with exit animation.
     * @param {string} ruleId
     */
    function dismissWarning(ruleId) {
      _dismissWithAnimation(ruleId);
    }

    /**
     * Dismiss a warning immediately (no animation) when violation no longer applies.
     * @param {string} ruleId
     */
    function _dismissWarningImmediate(ruleId) {
      var warning = _activeWarnings[ruleId];
      if (!warning) return;

      clearTimeout(warning.timeout);
      if (warning.element && warning.element.parentNode) {
        warning.element.parentNode.removeChild(warning.element);
      }
      delete _activeWarnings[ruleId];

      EventBus.emit('rule:warning_dismissed', { ruleId: ruleId });
    }

    /**
     * Dismiss a warning with exit animation.
     * @param {string} ruleId
     */
    function _dismissWithAnimation(ruleId) {
      var warning = _activeWarnings[ruleId];
      if (!warning) return;

      clearTimeout(warning.timeout);

      if (warning.element) {
        warning.element.classList.remove('rule-warning-toast--enter');
        warning.element.classList.add('rule-warning-toast--exit');

        // Remove after animation completes
        setTimeout(function () {
          if (warning.element && warning.element.parentNode) {
            warning.element.parentNode.removeChild(warning.element);
          }
        }, 300);
      }

      delete _activeWarnings[ruleId];
      EventBus.emit('rule:warning_dismissed', { ruleId: ruleId });
    }

    /**
     * Clear all active warnings (e.g., when form is reset or view changes).
     */
    function clearAll() {
      for (var ruleId in _activeWarnings) {
        if (Object.prototype.hasOwnProperty.call(_activeWarnings, ruleId)) {
          _dismissWarningImmediate(ruleId);
        }
      }
      _warningQueue = [];
      if (_queueTimer) {
        clearTimeout(_queueTimer);
        _queueTimer = null;
      }
      _lastCheck = {};
    }

    /**
     * Debounced input handler for entry form fields.
     */
    function _onInputChange() {
      if (!_active) return;
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function () {
        check();
      }, DEBOUNCE_MS);
    }

    /**
     * Bind input event listeners to entry form fields.
     */
    function _bindFormEvents() {
      var hoursInput = document.getElementById('entry-hours');
      var dateInput = document.getElementById('entry-date');
      var jobSelect = document.getElementById('entry-job');

      if (hoursInput) {
        hoursInput.addEventListener('input', _onInputChange);
      }
      if (dateInput) {
        dateInput.addEventListener('change', _onInputChange);
      }
      if (jobSelect) {
        jobSelect.addEventListener('change', _onInputChange);
      }
    }

    /**
     * Initialize: bind to entry form input events, subscribe to navigation events.
     */
    function init() {
      _bindFormEvents();

      // Activate/deactivate when entry view shown/hidden
      EventBus.on('navigation:change', function (data) {
        if (data && (data.viewId === 'view-entry' || data.view === 'view-entry')) {
          _active = true;
        } else {
          _active = false;
          clearAll();
        }
      });

      // Check if we're already on the entry view
      if (NavigationController.getActiveView() === 'view-entry') {
        _active = true;
      }
    }

    return { init: init, check: check, dismissWarning: dismissWarning, clearAll: clearAll };
  })();

  // ─── MinijobForecastWidget ──────────────────────────────────────────────────
  // Displays projected annual earnings for active Minijobs with traffic-light
  // status indicators and warnings when approaching the 7,236€ limit.
  // Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
  const MinijobForecastWidget = (function () {
    var ANNUAL_LIMIT = 7236;       // 12 × 603€
    var WARNING_THRESHOLD = 5789;  // ~80% of limit

    /**
     * Initializes the widget: checks for active Minijobs, renders if applicable,
     * and subscribes to relevant EventBus events.
     */
    function init() {
      // Subscribe to events that require recalculation
      EventBus.on('workday:saved', function () { update(); });
      EventBus.on('workday:deleted', function () { update(); });
      EventBus.on('income:updated', function () { update(); });
      EventBus.on('job:created', function () { update(); });
      EventBus.on('job:deleted', function () { update(); });

      // Initial render
      update();
    }

    /**
     * Recalculates and re-renders the forecast widget.
     */
    function update() {
      var widget = document.getElementById('minijob-forecast-widget');
      if (!widget) return;
      widget.classList.add('forecast-widget--hidden');
      widget.style.display = 'none';
    }

    /**
     * Gets current forecast data.
     * @returns {{ ytd: number, projected: number, remaining: number, status: string }}
     */
    function getForecast() {
      var activeMinijobs = _getActiveMinijobs();

      if (activeMinijobs.length === 0) {
        return { ytd: 0, projected: 0, remaining: ANNUAL_LIMIT, status: 'safe' };
      }

      var now = new Date();
      var currentYear = now.getFullYear();
      var currentMonth = now.getMonth() + 1; // 1-12

      // Calculate year-to-date earnings from all active Minijobs
      var ytdEarnings = _calculateYTDEarnings(activeMinijobs, currentYear);

      // Calculate elapsed months (fully elapsed calendar months, min 1)
      var elapsedMonths = _getElapsedMonths(currentMonth);

      // Handle January edge case: no entries exist
      var hasEntries = _hasEntriesInYear(activeMinijobs, currentYear);
      if (currentMonth === 1 && !hasEntries) {
        return { ytd: 0, projected: 0, remaining: ANNUAL_LIMIT, status: 'safe' };
      }

      // Calculate projected annual
      var projected = (ytdEarnings / elapsedMonths) * 12;

      // Calculate remaining budget
      var remaining = ANNUAL_LIMIT - ytdEarnings;

      // Determine status
      var status;
      if (projected > ANNUAL_LIMIT) {
        status = 'danger';
      } else if (projected >= WARNING_THRESHOLD) {
        status = 'warning';
      } else {
        status = 'safe';
      }

      return {
        ytd: Math.round(ytdEarnings * 100) / 100,
        projected: Math.round(projected * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        status: status
      };
    }

    /**
     * Returns active Minijob jobs (start_date <= today AND (end_date is null OR end_date >= today)).
     * @returns {object[]}
     */
    function _getActiveMinijobs() {
      var activeJobs = JobManager.getActiveJobs();
      return activeJobs.filter(function (job) {
        return job.type === 'Minijob';
      });
    }

    /**
     * Calculates year-to-date gross earnings from all active Minijobs.
     * Uses IncomeEngine.calculateMonthlyBrutto for each month up to the current month.
     * @param {object[]} minijobs - Array of active Minijob objects
     * @param {number} year - Current year
     * @returns {number}
     */
    function _calculateYTDEarnings(minijobs, year) {
      var now = new Date();
      var currentMonth = now.getMonth() + 1;
      var total = 0;

      for (var i = 0; i < minijobs.length; i++) {
        for (var m = 1; m <= currentMonth; m++) {
          total += IncomeEngine.calculateMonthlyBrutto(minijobs[i].id, year, m);
        }
      }

      return total;
    }

    /**
     * Returns the number of fully elapsed calendar months (min 1).
     * In January, this returns 1 (since no months have fully elapsed, we use min 1).
     * In February, 1 month has elapsed (January). In March, 2 months, etc.
     * @param {number} currentMonth - Current month (1-12)
     * @returns {number}
     */
    function _getElapsedMonths(currentMonth) {
      // Fully elapsed months = currentMonth - 1 (e.g., in March, Jan and Feb are elapsed)
      // But we use min 1 to avoid division by zero
      var elapsed = currentMonth - 1;
      return elapsed < 1 ? 1 : elapsed;
    }

    /**
     * Checks if any workday entries exist for the given Minijobs in the given year.
     * @param {object[]} minijobs
     * @param {number} year
     * @returns {boolean}
     */
    function _hasEntriesInYear(minijobs, year) {
      var workdays = AppState.getState().workdays;
      var prefix = String(year) + '-';

      for (var i = 0; i < minijobs.length; i++) {
        for (var j = 0; j < workdays.length; j++) {
          if (workdays[j].jobId === minijobs[i].id && workdays[j].date && workdays[j].date.startsWith(prefix)) {
            return true;
          }
        }
      }
      return false;
    }

    /**
     * Renders the forecast data into the DOM.
     * @param {{ ytd: number, projected: number, remaining: number, status: string }} forecast
     */
    function _renderForecast(forecast) {
      var ytdEl = document.getElementById('minijob-forecast-ytd');
      var projectedEl = document.getElementById('minijob-forecast-projected');
      var remainingEl = document.getElementById('minijob-forecast-remaining');
      var statusEl = document.getElementById('minijob-forecast-status');
      var warningEl = document.getElementById('minijob-forecast-warning');
      var progressFill = document.querySelector('.forecast-progress-fill');

      if (ytdEl) ytdEl.textContent = _formatCurrency(forecast.ytd);
      if (projectedEl) projectedEl.textContent = _formatCurrency(forecast.projected);
      if (remainingEl) remainingEl.textContent = _formatCurrency(forecast.remaining);

      // Update status indicator
      if (statusEl) {
        statusEl.className = 'forecast-status forecast-status--' + forecast.status;
      }

      // Update warning text
      if (warningEl) {
        // Honor the global minijob-warning preference
        var minijobAllowed = true;
        try {
          if (typeof NotificationScheduler !== 'undefined' && NotificationScheduler.getPreferences) {
            var p = NotificationScheduler.getPreferences();
            if (p && p.minijobWarning && p.minijobWarning.enabled === false) {
              minijobAllowed = false;
            }
          }
        } catch (e) { /* default to allow */ }

        if (forecast.status === 'danger' && minijobAllowed) {
          warningEl.textContent = 'Jahresgrenze wird voraussichtlich überschritten';
          warningEl.style.display = '';
        } else {
          warningEl.textContent = '';
          warningEl.style.display = 'none';
        }
      }

      // Update progress bar fill width proportional to ytd/limit
      if (progressFill) {
        var percentage = Math.min((forecast.ytd / ANNUAL_LIMIT) * 100, 100);
        progressFill.style.width = percentage + '%';
      }
    }

    /**
     * Formats a number as German currency (e.g., 1.234,56 €).
     * @param {number} value
     * @returns {string}
     */
    function _formatCurrency(value) {
      var parts = value.toFixed(2).split('.');
      var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return intPart + ',' + parts[1] + ' €';
    }

    return { init: init, update: update, getForecast: getForecast };
  })();

  // ─── DashboardOrderManager ───────────────────────────────────────────────────
  // Grid-based dashboard reorder for #view-daily / .dashboard-grid. Widgets
  // declare a size via data-widget-size="full" | "small". The grid is a
  // 2-column CSS grid; small widgets occupy one column, full widgets span
  // both columns. Widget order is persisted in localStorage under
  // 'jt_dashboard_order' as a flat array of data-widget-id values.
  //
  // Drag mechanic (iOS Homescreen-style):
  //   - touchstart: capture pointer + widget rects
  //   - touchmove (passive:false → preventDefault): translate the dragged
  //     widget under the finger; hit-test sibling widgets to mark a target
  //     slot. DO NOT mutate the DOM during move — instead apply preview
  //     transforms to "displaced" widgets so the swap is visually rehearsed.
  //   - touchend: commit the DOM reorder, reset all transforms, persist order.
  //
  // The dragged widget never leaves the DOM. Its inline transform composes
  // translate + scale + slight rotation for the iOS-elevated feel.
  const DashboardOrderManager = (function () {
    var STORAGE_KEY = 'jt_dashboard_order';
    var DRAG_THRESHOLD_PX = 6;
    var LONG_PRESS_MS = 500;
    var LONG_PRESS_MOVE_TOLERANCE = 10;

    var _editMode = false;
    var _initialized = false;

    // Long-press state
    var _longPressTimer = null;
    var _longPressStartX = 0;
    var _longPressStartY = 0;
    var _longPressTarget = null;

    // Drag session state
    var _dragEl = null;
    var _dragging = false;
    var _startX = 0;
    var _startY = 0;
    var _startRect = null;        // rect of dragged widget at drag start (post-CSS-transform reset)
    var _dragMode = null;         // 'touch' | 'pointer'
    var _activePointerId = null;
    var _siblings = [];           // siblings minus dragEl, captured at drag start
    var _siblingStartRects = [];  // their rects at drag start
    var _displacedTransforms = {};// widget-id → applied translate string (for cleanup)
    var _previewTargetIdx = -1;   // index in _siblings of the widget the dragged item would swap with
    var _previewInsertBefore = null; // 'true'/'false' boolean indicating insertion side relative to target
    var _cachedClone = null;      // off-screen grid clone for FLIP predictions (cached at drag start)
    var _moveRafId = null;        // rAF ID for debouncing touchmove hit-test

    /**
     * Initialize: apply saved order, wire long-press + drag listeners, wire Fertig button.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      _applySavedOrder();
      _wireWidgets();

      // Wire "Fertig" button to exit edit mode
      var doneBtn = document.getElementById('dashboard-edit-done');
      if (doneBtn && !doneBtn._reorderBound) {
        doneBtn._reorderBound = true;
        doneBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          setEditMode(false);
        });
      }

      // Tap outside widgets to exit edit mode
      document.addEventListener('click', function (e) {
        if (!_editMode) return;
        var target = e.target;
        // Check if tap is on a widget or the done button
        var isWidget = target.closest && target.closest('[data-reorderable="true"]');
        var isDone = target.closest && target.closest('#dashboard-edit-done');
        if (!isWidget && !isDone) {
          setEditMode(false);
        }
      });

      EventBus.on('data:imported', function () {
        _applySavedOrder();
        _wireWidgets();
      });
      EventBus.on('navigation:change', function (data) {
        if (data && (data.viewId === 'view-daily' || data.view === 'view-daily')) {
          _applySavedOrder();
          _wireWidgets();
        } else if (_editMode) {
          setEditMode(false);
        }
      });
    }

    /**
     * Toggle reorder edit mode.
     * @param {boolean} enabled
     */
    function setEditMode(enabled) {
      _editMode = !!enabled;

      var grid = document.querySelector('.dashboard-grid');

      if (_editMode) {
        document.body.classList.add('dashboard-edit-mode');
        // Performance: GPU hints during edit mode
        if (grid) {
          grid.style.contain = 'layout style';
        }
        var widgets = _getReorderableWidgets();
        for (var i = 0; i < widgets.length; i++) {
          widgets[i].style.willChange = 'transform';
        }
      } else {
        document.body.classList.remove('dashboard-edit-mode');
        document.body.classList.remove('widget-dragging');
        // Remove GPU hints
        if (grid) {
          grid.style.contain = '';
        }
        var widgetsOff = _getReorderableWidgets();
        for (var j = 0; j < widgetsOff.length; j++) {
          widgetsOff[j].style.willChange = '';
        }
        _cancelDrag();
      }
      _wireWidgets();
    }

    /**
     * Wire touch + pointer listeners on each reorderable widget. Idempotent.
     * In non-edit mode: long-press detection to enter edit mode.
     * In edit mode: direct drag on touch.
     */
    function _wireWidgets() {
      var widgets = _getReorderableWidgets();
      for (var i = 0; i < widgets.length; i++) {
        var w = widgets[i];
        if (w._gridReorderWired) continue;
        w._gridReorderWired = true;

        // Make sure no leftover HTML5 DnD sneaks in
        w.removeAttribute('draggable');

        // Touch path — passive:false on touchmove so we can preventDefault()
        // and stop iOS Safari from hijacking the gesture as a page scroll.
        w.addEventListener('touchstart', _onTouchStart, { passive: true });
        w.addEventListener('touchmove', _onTouchMove, { passive: false });
        w.addEventListener('touchend', _onTouchEnd, { passive: true });
        w.addEventListener('touchcancel', _onTouchEnd, { passive: true });

        // Pointer / mouse path
        w.addEventListener('pointerdown', _onPointerDown);
      }
    }

    /**
     * Get reorderable widgets in current DOM order (the dashboard-grid children).
     * @returns {HTMLElement[]}
     */
    function _getReorderableWidgets() {
      var view = document.getElementById('view-daily');
      if (!view) return [];
      var grid = view.querySelector('.dashboard-grid');
      var scope = grid || view;
      var nodes = scope.querySelectorAll('[data-reorderable="true"][data-widget-id]');
      return Array.prototype.slice.call(nodes);
    }

    /**
     * Apply the saved order from localStorage by reordering grid children.
     * Tolerates new widgets (appends them) and removed widgets (skipped).
     */
    function _applySavedOrder() {
      var saved = _loadOrder();
      if (!saved || !saved.length) return;

      var widgets = _getReorderableWidgets();
      if (!widgets.length) return;

      var byId = {};
      for (var i = 0; i < widgets.length; i++) {
        var id = widgets[i].getAttribute('data-widget-id');
        if (id) byId[id] = widgets[i];
      }

      var parent = widgets[0].parentNode;
      if (!parent) return;

      var seen = {};
      for (var j = 0; j < saved.length; j++) {
        var sid = saved[j];
        if (byId[sid] && byId[sid].parentNode === parent) {
          parent.appendChild(byId[sid]);
          seen[sid] = true;
        }
      }
      for (var k = 0; k < widgets.length; k++) {
        var wid = widgets[k].getAttribute('data-widget-id');
        if (wid && !seen[wid] && widgets[k].parentNode === parent) {
          parent.appendChild(widgets[k]);
        }
      }
    }

    /**
     * Persist current widget order to localStorage.
     */
    function _saveCurrentOrder() {
      var widgets = _getReorderableWidgets();
      var ids = [];
      for (var i = 0; i < widgets.length; i++) {
        var id = widgets[i].getAttribute('data-widget-id');
        if (id) ids.push(id);
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      } catch (e) { /* silent */ }
    }

    function _loadOrder() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch (e) {
        return null;
      }
    }

    // ─── Touch handlers ──────────────────────────────────────────────────────

    function _onTouchStart(e) {
      if (_dragEl) return;
      if (!e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];

      if (_editMode) {
        // Already in edit mode — start drag immediately
        _beginDrag(this, t.clientX, t.clientY, 'touch');
      } else {
        // Not in edit mode — start long-press timer
        _longPressTarget = this;
        _longPressStartX = t.clientX;
        _longPressStartY = t.clientY;
        _longPressTimer = setTimeout(function () {
          _longPressTimer = null;
          // Prevent any lingering selection
          window.getSelection().removeAllRanges();
          // Enter edit mode and immediately start dragging this widget
          if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.tap) {
            HapticFeedbackService.tap(30);
          }
          setEditMode(true);
          _beginDrag(_longPressTarget, _longPressStartX, _longPressStartY, 'touch');
          // Force into dragging state immediately (skip threshold)
          _dragging = true;
          _dragEl.classList.add('widget--dragging');
          _dragEl.style.transition = 'none';
          document.body.classList.add('widget-dragging');
          _longPressTarget = null;
        }, LONG_PRESS_MS);
      }
    }

    function _onTouchMove(e) {
      if (!e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];

      // If long-press timer is active, check if finger moved too much
      if (_longPressTimer) {
        var dx = t.clientX - _longPressStartX;
        var dy = t.clientY - _longPressStartY;
        if (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE) {
          clearTimeout(_longPressTimer);
          _longPressTimer = null;
          _longPressTarget = null;
        }
        return;
      }

      if (!_dragEl || _dragMode !== 'touch') return;
      if (_handleMove(t.clientX, t.clientY)) {
        // Once a drag is committed, swallow the gesture so iOS doesn't scroll.
        e.preventDefault();
      }
    }

    function _onTouchEnd() {
      // Cancel long-press if finger lifted before 500ms
      if (_longPressTimer) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
        _longPressTarget = null;
      }
      if (!_dragEl || _dragMode !== 'touch') return;
      _endDrag();
    }

    // ─── Pointer / mouse handlers ────────────────────────────────────────────

    function _onPointerDown(e) {
      if (!_editMode) return;
      if (e.pointerType === 'touch') return;  // touch path owns this
      if (_dragEl) return;
      _beginDrag(this, e.clientX, e.clientY, 'pointer');
      _activePointerId = e.pointerId;
      try { this.setPointerCapture(e.pointerId); } catch (err) {}
      this.addEventListener('pointermove', _onPointerMove);
      this.addEventListener('pointerup', _onPointerUp);
      this.addEventListener('pointercancel', _onPointerUp);
    }

    function _onPointerMove(e) {
      if (!_dragEl || _dragMode !== 'pointer') return;
      if (e.pointerId !== _activePointerId) return;
      _handleMove(e.clientX, e.clientY);
    }

    function _onPointerUp(e) {
      if (!_dragEl || _dragMode !== 'pointer') return;
      if (e && e.pointerId !== undefined && e.pointerId !== _activePointerId) return;
      var el = _dragEl;
      try { el.releasePointerCapture(_activePointerId); } catch (err) {}
      el.removeEventListener('pointermove', _onPointerMove);
      el.removeEventListener('pointerup', _onPointerUp);
      el.removeEventListener('pointercancel', _onPointerUp);
      _endDrag();
    }

    // ─── Shared drag logic ───────────────────────────────────────────────────

    /**
     * Begin a drag. Snapshots the widget rect — actual movement starts only
     * once the pointer travels beyond the threshold (so taps don't trigger drag).
     */
    function _beginDrag(el, x, y, mode) {
      _dragEl = el;
      _dragging = false;
      _startX = x;
      _startY = y;
      _dragMode = mode;
      _previewTargetIdx = -1;
      _previewInsertBefore = null;
      _displacedTransforms = {};

      // Capture rects right now (no transforms applied yet)
      _startRect = el.getBoundingClientRect();
      var widgets = _getReorderableWidgets();
      _siblings = [];
      _siblingStartRects = [];
      for (var i = 0; i < widgets.length; i++) {
        if (widgets[i] === el) continue;
        _siblings.push(widgets[i]);
        _siblingStartRects.push(widgets[i].getBoundingClientRect());
      }

      // Cache the off-screen clone for FLIP predictions (Issue 2 optimization)
      _cachedClone = _buildPredictionClone();
    }

    /**
     * Handle pointer movement during a drag. Returns true if a drag is active
     * (so callers can preventDefault() to suppress page scrolling).
     */
    function _handleMove(x, y) {
      if (!_dragEl) return false;
      var dx = x - _startX;
      var dy = y - _startY;

      if (!_dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return false;
        _dragging = true;
        _dragEl.classList.add('widget--dragging');
        _dragEl.style.transition = 'none';
        // Prevent page scroll during drag
        document.body.classList.add('widget-dragging');
      }

      // GPU-accelerated transform with translate3d
      _dragEl.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0) scale(1.05) rotate(0.6deg)';

      // Debounce hit-test to max once per frame via requestAnimationFrame
      var draggedCenterX = _startRect.left + _startRect.width / 2 + dx;
      var draggedCenterY = _startRect.top + _startRect.height / 2 + dy;

      if (_moveRafId) cancelAnimationFrame(_moveRafId);
      _moveRafId = requestAnimationFrame(function () {
        _updatePreview(draggedCenterX, draggedCenterY);
        _moveRafId = null;
      });

      return true;
    }

    /**
     * Update the preview placement: figure out which slot the dragged widget
     * would land in if released now, and apply translate transforms to the
     * displaced widgets so the swap is visually rehearsed (FLIP-style).
     *
     * Slot semantics:
     *   - Two small widgets sharing a row count as separate "half" slots.
     *   - A full widget always occupies one full row.
     *   - When the dragged widget is small over a small target on the same
     *     row → swap them horizontally.
     *   - When the dragged widget is small over a full target → it goes
     *     above/below the full row depending on Y position.
     *   - When the dragged widget is full over any target → it swaps
     *     with the entire row at the target.
     */
    function _updatePreview(centerX, centerY) {
      var hit = _hitTest(centerX, centerY);
      if (hit.targetIdx === _previewTargetIdx && hit.insertBefore === _previewInsertBefore) {
        return; // No change
      }

      _previewTargetIdx = hit.targetIdx;
      _previewInsertBefore = hit.insertBefore;

      // Compute the would-be DOM order, then for each non-dragged widget
      // calculate its predicted new rect and translate it from its current
      // position to that target. This produces a smooth FLIP preview without
      // mutating the actual DOM until pointerup.
      _applyPreviewTransforms();
    }

    /**
     * Hit-test: scan siblings, return which one (and which side) the pointer
     * center is over. Returns { targetIdx, insertBefore } where targetIdx is
     * the index in _siblings (-1 means no swap = stay in original slot).
     */
    function _hitTest(centerX, centerY) {
      var draggedSize = _dragEl.getAttribute('data-widget-size') || 'full';

      var bestIdx = -1;
      var bestInsertBefore = false;

      for (var i = 0; i < _siblings.length; i++) {
        var sibling = _siblings[i];
        var rect = sibling.getBoundingClientRect();

        // Reject if sibling has been displaced and its inline transform moved
        // it — use its ORIGINAL slot rect (from drag start) for predictable
        // hit-testing. Once the user moves between slots, _siblingStartRects
        // gives us the stable layout the user perceived at drag start.
        var startRect = _siblingStartRects[i];

        // Pointer must be vertically and horizontally inside the slot
        var inX = centerX >= startRect.left && centerX <= startRect.right;
        var inY = centerY >= startRect.top && centerY <= startRect.bottom;
        if (!inX || !inY) continue;

        var siblingSize = sibling.getAttribute('data-widget-size') || 'full';

        if (draggedSize === 'small' && siblingSize === 'small') {
          // Same-row horizontal swap: insertBefore depends on which half of
          // the target's width the pointer is in.
          var targetMidX = startRect.left + startRect.width / 2;
          bestIdx = i;
          bestInsertBefore = centerX < targetMidX;
        } else if (draggedSize === 'small' && siblingSize === 'full') {
          // Above or below depending on vertical center
          var targetMidY = startRect.top + startRect.height / 2;
          bestIdx = i;
          bestInsertBefore = centerY < targetMidY;
        } else if (draggedSize === 'full') {
          // Full-width drag: swap with the whole row of the target. Direction
          // (above or below) determined by vertical position.
          var midY = startRect.top + startRect.height / 2;
          bestIdx = i;
          bestInsertBefore = centerY < midY;
        } else {
          // dragged full-but-treated-default fallback
          bestIdx = i;
          bestInsertBefore = centerY < (startRect.top + startRect.height / 2);
        }
        break;
      }

      return { targetIdx: bestIdx, insertBefore: bestInsertBefore };
    }

    /**
     * Apply translate transforms to siblings based on the current preview.
     * Uses FLIP: reads original rects (captured at drag start), computes the
     * predicted post-DOM-mutation rects, applies a translate equal to
     * (predicted - original) so the displaced widget appears to slide in.
     */
    function _applyPreviewTransforms() {
      // Reset all sibling transforms first
      for (var i = 0; i < _siblings.length; i++) {
        var s = _siblings[i];
        s.classList.remove('widget--displaced');
        s.style.transform = '';
      }
      _displacedTransforms = {};

      if (_previewTargetIdx < 0) return;

      // Build the predicted new order array (data-widget-id strings) by
      // simulating where the dragged item would be inserted.
      var dragId = _dragEl.getAttribute('data-widget-id');
      var siblingIds = _siblings.map(function (s) { return s.getAttribute('data-widget-id'); });

      var targetSiblingId = _siblings[_previewTargetIdx].getAttribute('data-widget-id');
      var newOrder = [];
      for (var j = 0; j < siblingIds.length; j++) {
        if (siblingIds[j] === targetSiblingId && _previewInsertBefore) {
          newOrder.push(dragId);
        }
        newOrder.push(siblingIds[j]);
        if (siblingIds[j] === targetSiblingId && !_previewInsertBefore) {
          newOrder.push(dragId);
        }
      }
      // If for any reason dragId wasn't placed, append it
      if (newOrder.indexOf(dragId) < 0) newOrder.push(dragId);

      // Use cached clone for FLIP prediction (optimized: clone built once at drag start)
      var predictedRects = _getPredictedRects(newOrder, dragId, siblingIds);
      if (!predictedRects) return;

      // Apply translate3d transforms to each displaced sibling
      for (var m = 0; m < _siblings.length; m++) {
        var sib = _siblings[m];
        var sid = siblingIds[m];
        var startR = _siblingStartRects[m];
        var pr = predictedRects[sid];
        if (!pr) continue;
        var dx = pr.left - startR.left;
        var dy = pr.top - startR.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          continue;
        }
        sib.classList.add('widget--displaced');
        var transformStr = 'translate3d(' + dx + 'px, ' + dy + 'px, 0)';
        sib.style.transform = transformStr;
        _displacedTransforms[sid] = transformStr;
      }
    }

    /**
     * Build an off-screen grid clone once at drag start for FLIP predictions.
     */
    function _buildPredictionClone() {
      var grid = _dragEl.parentNode;
      if (!grid) return null;

      var clone = grid.cloneNode(false);
      var gridRect = grid.getBoundingClientRect();
      clone.style.position = 'absolute';
      clone.style.visibility = 'hidden';
      clone.style.left = '-99999px';
      clone.style.top = '0';
      clone.style.width = gridRect.width + 'px';
      var gridStyle = window.getComputedStyle(grid);
      clone.style.gridTemplateColumns = gridStyle.gridTemplateColumns;
      clone.style.gap = gridStyle.gap;
      clone.style.display = 'grid';
      clone.style.contain = 'layout style';

      document.body.appendChild(clone);
      return clone;
    }

    /**
     * Get predicted rects using the cached clone.
     */
    function _getPredictedRects(newOrder, dragId, siblingIds) {
      var clone = _cachedClone;
      if (!clone) return null;

      var grid = _dragEl.parentNode;
      if (!grid) return null;
      var gridRect = grid.getBoundingClientRect();

      // Clear previous placeholders
      clone.innerHTML = '';

      var placeholders = {};
      for (var k = 0; k < newOrder.length; k++) {
        var id = newOrder[k];
        var origEl = (id === dragId) ? _dragEl : _siblings[siblingIds.indexOf(id)];
        if (!origEl) continue;
        var ph = document.createElement('div');
        var origRect = (id === dragId) ? _startRect : _siblingStartRects[siblingIds.indexOf(id)];
        ph.style.height = origRect.height + 'px';
        ph.style.width = '100%';
        var size = origEl.getAttribute('data-widget-size') || 'full';
        if (size === 'full') {
          ph.style.gridColumn = '1 / -1';
        } else {
          ph.style.gridColumn = 'span 1';
        }
        clone.appendChild(ph);
        placeholders[id] = ph;
      }

      var cloneRect = clone.getBoundingClientRect();
      var predictedRects = {};
      for (var pid in placeholders) {
        if (Object.prototype.hasOwnProperty.call(placeholders, pid)) {
          var phRect = placeholders[pid].getBoundingClientRect();
          predictedRects[pid] = {
            left: gridRect.left + (phRect.left - cloneRect.left),
            top: gridRect.top + (phRect.top - cloneRect.top),
            width: phRect.width,
            height: phRect.height
          };
        }
      }

      return predictedRects;
    }

    /**
     * Commit the drag: mutate the DOM to reflect the preview, clear all
     * transforms, persist the new order. The dragged widget snaps to its new
     * grid slot naturally because we remove its inline transform after
     * insertion.
     */
    function _endDrag() {
      if (!_dragEl) return;
      var el = _dragEl;
      var didDrag = _dragging;
      var commitTargetIdx = _previewTargetIdx;
      var commitInsertBefore = _previewInsertBefore;

      // Cancel any pending rAF
      if (_moveRafId) { cancelAnimationFrame(_moveRafId); _moveRafId = null; }

      // Remove cached clone
      if (_cachedClone && _cachedClone.parentNode) {
        _cachedClone.parentNode.removeChild(_cachedClone);
      }
      _cachedClone = null;

      if (didDrag && commitTargetIdx >= 0) {
        var grid = el.parentNode;
        var targetSibling = _siblings[commitTargetIdx];

        if (grid && targetSibling && targetSibling.parentNode === grid) {
          if (commitInsertBefore) {
            grid.insertBefore(el, targetSibling);
          } else {
            if (targetSibling.nextSibling) {
              grid.insertBefore(el, targetSibling.nextSibling);
            } else {
              grid.appendChild(el);
            }
          }
        }
      }

      // Clear sibling transforms
      for (var i = 0; i < _siblings.length; i++) {
        var s = _siblings[i];
        s.classList.remove('widget--displaced');
        s.style.transform = '';
        s.style.transition = '';
      }

      // Clear dragged widget styles. Grid auto-flow places it correctly.
      el.style.transition = '';
      el.style.transform = '';
      el.style.position = '';
      el.style.zIndex = '';
      el.classList.remove('widget--dragging');

      // Remove scroll lock
      document.body.classList.remove('widget-dragging');

      _dragEl = null;
      _dragging = false;
      _activePointerId = null;
      _dragMode = null;
      _siblings = [];
      _siblingStartRects = [];
      _previewTargetIdx = -1;
      _previewInsertBefore = null;
      _displacedTransforms = {};
      _startRect = null;

      if (didDrag) {
        _saveCurrentOrder();
        if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.tap) {
          HapticFeedbackService.tap(20);
        }
      }
    }

    /**
     * Cancel an in-flight drag without persisting (e.g., when leaving edit mode).
     */
    function _cancelDrag() {
      if (!_dragEl) return;
      var el = _dragEl;

      // Cancel any pending rAF
      if (_moveRafId) { cancelAnimationFrame(_moveRafId); _moveRafId = null; }

      // Cancel any long-press timer
      if (_longPressTimer) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
        _longPressTarget = null;
      }

      // Remove cached clone
      if (_cachedClone && _cachedClone.parentNode) {
        _cachedClone.parentNode.removeChild(_cachedClone);
      }
      _cachedClone = null;

      for (var i = 0; i < _siblings.length; i++) {
        var s = _siblings[i];
        s.classList.remove('widget--displaced');
        s.style.transform = '';
      }
      el.style.transition = '';
      el.style.transform = '';
      el.style.position = '';
      el.style.zIndex = '';
      el.classList.remove('widget--dragging');
      document.body.classList.remove('widget-dragging');
      try { if (_activePointerId !== null) el.releasePointerCapture(_activePointerId); } catch (err) {}
      _dragEl = null;
      _dragging = false;
      _activePointerId = null;
      _dragMode = null;
      _siblings = [];
      _siblingStartRects = [];
      _previewTargetIdx = -1;
      _previewInsertBefore = null;
      _displacedTransforms = {};
      _startRect = null;
    }

    return {
      init: init,
      setEditMode: setEditMode,
      isEditMode: function () { return _editMode; }
    };
  })();

  // ─── GeoReminderService ────────────────────────────────────────────────────────
  // Monitors device location relative to configured workplace coordinates and
  // triggers push notifications when the user leaves the geofence (200m radius).
  // Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9
  const GeoReminderService = (function () {
    var STORAGE_KEY = 'jt_geo_reminders';
    var GEOFENCE_RADIUS_M = 200;
    var EARTH_RADIUS_M = 6371000;

    // Geolocation watchPosition options
    var WATCH_OPTIONS = {
      enableHighAccuracy: false,
      maximumAge: 60000,
      timeout: 300000
    };

    var _reminders = {};       // { jobId: { lat, lng, enabled, lastNotifiedDate } }
    var _watchId = null;       // geolocation watchPosition ID
    var _insideState = {};     // { jobId: boolean } — true if inside geofence
    var _initialized = false;

    /**
     * Initialize: load saved locations, subscribe to events, start monitoring.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      _loadReminders();

      // Subscribe to EventBus events
      EventBus.on('job:deleted', function (data) {
        if (data && data.id) {
          removeLocation(data.id);
        }
      });

      EventBus.on('job:updated', function (data) {
        if (data && data.id && _reminders[data.id]) {
          // Check if job is still active; if not, stop monitoring for it
          var jobs = AppState.get('jobs') || [];
          var job = null;
          for (var i = 0; i < jobs.length; i++) {
            if (jobs[i].id === data.id) { job = jobs[i]; break; }
          }
          if (!job) {
            removeLocation(data.id);
          }
        }
      });

      // Start monitoring if there are active reminders
      _startMonitoring();
    }

    /**
     * Set workplace coordinates for a job.
     * @param {string} jobId
     * @param {number} lat - Latitude (6 decimal places)
     * @param {number} lng - Longitude (6 decimal places)
     * @param {string} [address] - Display address string
     * @returns {{ success: boolean, error?: string }}
     */
    function setLocation(jobId, lat, lng, address) {
      // Validate coordinates
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return { success: false, error: 'Koordinaten müssen Zahlen sein.' };
      }
      if (lat < -90 || lat > 90) {
        return { success: false, error: 'Breitengrad muss zwischen -90 und 90 liegen.' };
      }
      if (lng < -180 || lng > 180) {
        return { success: false, error: 'Längengrad muss zwischen -180 und 180 liegen.' };
      }

      // Round to 6 decimal places precision
      var roundedLat = Math.round(lat * 1000000) / 1000000;
      var roundedLng = Math.round(lng * 1000000) / 1000000;

      _reminders[jobId] = {
        lat: roundedLat,
        lng: roundedLng,
        enabled: true,
        lastNotifiedDate: null,
        address: address || ''
      };

      _persistReminders();

      // Establish baseline: user is currently inside the geofence
      _insideState[jobId] = true;

      // Start monitoring if not already active
      _startMonitoring();

      return { success: true };
    }

    /**
     * Remove workplace coordinates for a job.
     * @param {string} jobId
     */
    function removeLocation(jobId) {
      if (_reminders[jobId]) {
        delete _reminders[jobId];
        delete _insideState[jobId];
        _persistReminders();

        // Stop monitoring if no active reminders remain
        if (Object.keys(_reminders).length === 0) {
          _stopMonitoring();
        }
      }
    }

    /**
     * Get current location via Geolocation API (for "use current position").
     * @param {Function} callback - Receives { lat, lng } or { error }
     */
    function getCurrentPosition(callback) {
      if (!navigator.geolocation) {
        callback({ error: 'Geolocation API nicht verfügbar.' });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (position) {
          var lat = Math.round(position.coords.latitude * 1000000) / 1000000;
          var lng = Math.round(position.coords.longitude * 1000000) / 1000000;
          callback({ lat: lat, lng: lng });
        },
        function (error) {
          if (error.code === error.PERMISSION_DENIED) {
            showToast('Standort-Erinnerungen benötigen die Standortberechtigung.', 5000);
            EventBus.emit('geo:permission_denied', {});
            callback({ error: 'permission_denied' });
          } else {
            callback({ error: error.message || 'Position nicht verfügbar.' });
          }
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    }

    /**
     * Check if geo-reminders are active for a job.
     * @param {string} jobId
     * @returns {boolean}
     */
    function isActive(jobId) {
      return !!(_reminders[jobId] && _reminders[jobId].enabled);
    }

    /**
     * Stop all monitoring (e.g., on app teardown).
     */
    function stopAll() {
      _stopMonitoring();
      _insideState = {};
    }

    // ── Private Methods ──

    /**
     * Load reminders from localStorage.
     */
    function _loadReminders() {
      var result = LocalStorageManager.load(STORAGE_KEY);
      if (result.success && result.data !== null && typeof result.data === 'object') {
        _reminders = result.data;
        // Initialize inside state for all enabled reminders
        for (var jobId in _reminders) {
          if (_reminders.hasOwnProperty(jobId) && _reminders[jobId].enabled) {
            // Assume inside on load (Req 2.9: only trigger on transition from inside to outside)
            _insideState[jobId] = true;
          }
        }
      }
    }

    /**
     * Persist reminders to localStorage.
     */
    function _persistReminders() {
      LocalStorageManager.save(STORAGE_KEY, _reminders);
    }

    /**
     * Start geofence monitoring via watchPosition.
     */
    function _startMonitoring() {
      // Don't start if no enabled reminders
      var hasActive = false;
      for (var jobId in _reminders) {
        if (_reminders.hasOwnProperty(jobId) && _reminders[jobId].enabled) {
          hasActive = true;
          break;
        }
      }
      if (!hasActive) return;

      // Don't start if already watching
      if (_watchId !== null) return;

      // Check geolocation support
      if (!navigator.geolocation) return;

      _watchId = navigator.geolocation.watchPosition(
        _onPositionUpdate,
        _onPositionError,
        WATCH_OPTIONS
      );
    }

    /**
     * Stop geofence monitoring.
     */
    function _stopMonitoring() {
      if (_watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(_watchId);
        _watchId = null;
      }
    }

    /**
     * Handle position update from watchPosition.
     * @param {GeolocationPosition} position
     */
    function _onPositionUpdate(position) {
      var currentLat = position.coords.latitude;
      var currentLng = position.coords.longitude;

      for (var jobId in _reminders) {
        if (!_reminders.hasOwnProperty(jobId)) continue;
        var reminder = _reminders[jobId];
        if (!reminder.enabled) continue;

        var distance = _haversineDistance(
          currentLat, currentLng,
          reminder.lat, reminder.lng
        );

        var isInside = distance <= GEOFENCE_RADIUS_M;
        var wasInside = _insideState[jobId] !== false; // default to true if unknown

        // Update state
        _insideState[jobId] = isInside;

        // Only trigger on transition from inside to outside
        if (wasInside && !isInside) {
          _triggerNotification(jobId);
        }
      }
    }

    /**
     * Handle position error from watchPosition.
     * Retry at next interval, do not trigger notification.
     * @param {GeolocationPositionError} error
     */
    function _onPositionError(error) {
      if (error.code === error.PERMISSION_DENIED) {
        // Permission denied: show toast, disable all reminders, emit event
        showToast('Standort-Erinnerungen benötigen die Standortberechtigung.', 5000);

        // Disable all reminders
        for (var jobId in _reminders) {
          if (_reminders.hasOwnProperty(jobId)) {
            _reminders[jobId].enabled = false;
          }
        }
        _persistReminders();
        _stopMonitoring();

        EventBus.emit('geo:permission_denied', {});
      }
      // For other errors (POSITION_UNAVAILABLE, TIMEOUT): do nothing,
      // watchPosition will retry at next interval automatically
    }

    /**
     * Trigger a notification for a job leaving the geofence.
     * Enforces one notification per job per calendar day.
     * Globally gated by NotificationScheduler.geoReminder preference.
     * @param {string} jobId
     */
    function _triggerNotification(jobId) {
      var today = _getTodayDateString();

      // Honor global geo-reminder preference (Settings → Benachrichtigungen)
      try {
        if (typeof NotificationScheduler !== 'undefined' && NotificationScheduler.getPreferences) {
          var prefs = NotificationScheduler.getPreferences();
          if (prefs && prefs.geoReminder && prefs.geoReminder.enabled === false) {
            return;
          }
        }
      } catch (e) { /* default to allow */ }

      // Enforce one notification per job per calendar day
      if (_reminders[jobId].lastNotifiedDate === today) {
        return;
      }

      // Check Notification API permission
      if (!('Notification' in window)) return;

      if (Notification.permission === 'denied') {
        showToast('Benachrichtigungen benötigen die Berechtigung.', 5000);
        _reminders[jobId].enabled = false;
        _persistReminders();
        return;
      }

      if (Notification.permission === 'granted') {
        _sendNotification(jobId, today);
      } else {
        // Request permission
        Notification.requestPermission().then(function (permission) {
          if (permission === 'granted') {
            _sendNotification(jobId, today);
          } else {
            showToast('Benachrichtigungen benötigen die Berechtigung.', 5000);
            _reminders[jobId].enabled = false;
            _persistReminders();
          }
        });
      }
    }

    /**
     * Send the actual notification and update lastNotifiedDate.
     * @param {string} jobId
     * @param {string} today - Date string YYYY-MM-DD
     */
    function _sendNotification(jobId, today) {
      // Get job name for notification body
      var jobName = '';
      var jobs = AppState.get('jobs') || [];
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].id === jobId) {
          jobName = jobs[i].name || jobs[i].employer || '';
          break;
        }
      }

      var body = jobName
        ? 'Du hast den Arbeitsplatz (' + jobName + ') verlassen. Stunden eintragen?'
        : 'Du hast den Arbeitsplatz verlassen. Stunden eintragen?';

      var options = {
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'geo-reminder-' + jobId
      };

      // Prefer the service-worker registration for PWA compatibility on Android.
      // Falls back to the Notification constructor on platforms where SW is unavailable.
      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (registration) {
          if (registration && typeof registration.showNotification === 'function') {
            registration.showNotification('Schicht beendet?', options);
          } else {
            try { new Notification('Schicht beendet?', options); } catch (e) { /* ignore */ }
          }
        }).catch(function () {
          try { new Notification('Schicht beendet?', options); } catch (e) { /* ignore */ }
        });
      } else {
        try {
          new Notification('Schicht beendet?', options);
        } catch (e) {
          // Notification constructor may fail in some contexts; ignore
          return;
        }
      }

      // Update lastNotifiedDate
      _reminders[jobId].lastNotifiedDate = today;
      _persistReminders();

      // Emit event
      EventBus.emit('geo:reminder_triggered', { jobId: jobId, date: today });
    }

    /**
     * Calculate Haversine distance between two points in meters.
     * @param {number} lat1 - Latitude of point 1 (degrees)
     * @param {number} lng1 - Longitude of point 1 (degrees)
     * @param {number} lat2 - Latitude of point 2 (degrees)
     * @param {number} lng2 - Longitude of point 2 (degrees)
     * @returns {number} Distance in meters
     */
    function _haversineDistance(lat1, lng1, lat2, lng2) {
      var dLat = _toRadians(lat2 - lat1);
      var dLng = _toRadians(lng2 - lng1);
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(_toRadians(lat1)) * Math.cos(_toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return EARTH_RADIUS_M * c;
    }

    /**
     * Convert degrees to radians.
     * @param {number} degrees
     * @returns {number}
     */
    function _toRadians(degrees) {
      return degrees * (Math.PI / 180);
    }

    /**
     * Get today's date as YYYY-MM-DD string in local timezone.
     * @returns {string}
     */
    function _getTodayDateString() {
      var now = new Date();
      var year = now.getFullYear();
      var month = String(now.getMonth() + 1).padStart(2, '0');
      var day = String(now.getDate()).padStart(2, '0');
      return year + '-' + month + '-' + day;
    }

    return {
      init: init,
      setLocation: setLocation,
      removeLocation: removeLocation,
      getCurrentPosition: getCurrentPosition,
      isActive: isActive,
      stopAll: stopAll
    };
  })();

  // ─── NotificationScheduler ─────────────────────────────────────────────────
  // Manages user-configurable notification preferences and schedules a daily
  // evening reminder to log hours. Stores preferences in localStorage under
  // 'jt_notification_prefs'. Other notification types (geo, rule warnings,
  // minijob warnings) consult getPreferences() to gate themselves.
  //
  // iOS PWA caveat: setTimeout() doesn't survive when the PWA is closed
  // (the JS runtime is suspended). So in addition to scheduling a setTimeout
  // for the next reminder, we also do a "missed reminder" check on every app
  // open: if the current time is past the configured hour:minute and we
  // haven't already logged hours for today, show an in-app banner immediately.
  const NotificationScheduler = (function () {
    var STORAGE_KEY = 'jt_notification_prefs';
    var LAST_TRIGGER_KEY = 'jt_evening_reminder_last';
    var LAST_MORNING_TRIGGER_KEY = 'jt_morning_reminder_last';
    var DEFAULTS = {
      eveningReminder: { enabled: true, hour: 22, minute: 0 },
      morningReminder: { enabled: false, hour: 7, minute: 0 },
      geoReminder:     { enabled: true },
      ruleWarning:     { enabled: true },
      minijobWarning:  { enabled: true }
    };

    var _prefs = null;
    var _eveningTimerId = null;
    var _morningTimerId = null;
    var _initialized = false;

    /**
     * Initialize: load prefs, schedule next reminder, run missed-reminder check.
     */
    function init() {
      if (_initialized) return;
      _initialized = true;

      _loadPrefs();
      _bindUI();

      // Run missed-reminder check now (handles iOS PWA reopens after suspension)
      _checkMissedReminder();
      _checkMissedMorning();

      // Schedule the next evening + morning reminders via setTimeout
      _scheduleNextEvening();
      _scheduleNextMorning();

      // Subscribe so a freshly-saved workday cancels today's pending reminder
      EventBus.on('workday:saved', function () {
        // The user just logged hours — record today as "logged" so we don't
        // ping them again today.
        _markLoggedToday();
      });
    }

    /**
     * Configure the evening reminder time.
     * @param {number} hour 0-23
     * @param {number} minute 0-59
     */
    function setReminderTime(hour, minute) {
      if (typeof hour !== 'number' || typeof minute !== 'number') return;
      _prefs.eveningReminder.hour = Math.max(0, Math.min(23, hour|0));
      _prefs.eveningReminder.minute = Math.max(0, Math.min(59, minute|0));
      _persistPrefs();
      _scheduleNextEvening();
    }

    /**
     * Configure the morning reminder time.
     * @param {number} hour 0-23
     * @param {number} minute 0-59
     */
    function setMorningReminderTime(hour, minute) {
      if (typeof hour !== 'number' || typeof minute !== 'number') return;
      _prefs.morningReminder.hour = Math.max(0, Math.min(23, hour|0));
      _prefs.morningReminder.minute = Math.max(0, Math.min(59, minute|0));
      _persistPrefs();
      _scheduleNextMorning();
    }

    /**
     * Enable/disable a specific notification type.
     * @param {string} type 'evening_reminder' | 'morning_reminder' | 'geo_reminder' | 'rule_warning' | 'minijob_warning'
     * @param {boolean} enabled
     */
    function enableType(type, enabled) {
      var key = null;
      if (type === 'evening_reminder') key = 'eveningReminder';
      else if (type === 'morning_reminder') key = 'morningReminder';
      else if (type === 'geo_reminder') key = 'geoReminder';
      else if (type === 'rule_warning') key = 'ruleWarning';
      else if (type === 'minijob_warning') key = 'minijobWarning';
      if (!key || !_prefs[key]) return;

      _prefs[key].enabled = !!enabled;
      _persistPrefs();

      if (key === 'eveningReminder') {
        _scheduleNextEvening();
      } else if (key === 'morningReminder') {
        _scheduleNextMorning();
      }
    }

    /**
     * @returns {object} A defensive copy of the current preferences.
     */
    function getPreferences() {
      return JSON.parse(JSON.stringify(_prefs));
    }

    /**
     * Cancel all scheduled reminders.
     */
    function clearAll() {
      if (_eveningTimerId !== null) {
        clearTimeout(_eveningTimerId);
        _eveningTimerId = null;
      }
      if (_morningTimerId !== null) {
        clearTimeout(_morningTimerId);
        _morningTimerId = null;
      }
    }

    // ── Private ────────────────────────────────────────────────────────────

    function _loadPrefs() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          // Merge over defaults so newly-added keys appear with their defaults
          _prefs = {
            eveningReminder: Object.assign({}, DEFAULTS.eveningReminder, parsed.eveningReminder || {}),
            morningReminder: Object.assign({}, DEFAULTS.morningReminder, parsed.morningReminder || {}),
            geoReminder:     Object.assign({}, DEFAULTS.geoReminder, parsed.geoReminder || {}),
            ruleWarning:     Object.assign({}, DEFAULTS.ruleWarning, parsed.ruleWarning || {}),
            minijobWarning:  Object.assign({}, DEFAULTS.minijobWarning, parsed.minijobWarning || {})
          };
          return;
        }
      } catch (e) { /* fall through to defaults */ }
      _prefs = JSON.parse(JSON.stringify(DEFAULTS));
    }

    function _persistPrefs() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
      } catch (e) { /* silent */ }
    }

    function _bindUI() {
      var eveningToggle = document.getElementById('notif-evening-toggle');
      var eveningTimeInput = document.getElementById('notif-evening-time');
      var morningToggle = document.getElementById('notif-morning-toggle');
      var morningTimeInput = document.getElementById('notif-morning-time');
      var geoToggle = document.getElementById('notif-geo-toggle');
      var ruleToggle = document.getElementById('notif-rule-toggle');
      var minijobToggle = document.getElementById('notif-minijob-toggle');
      var enableBtn = document.getElementById('notif-enable-btn');
      var blockedHint = document.getElementById('notif-blocked-hint');

      if (eveningToggle) {
        eveningToggle.checked = _prefs.eveningReminder.enabled;
        eveningToggle.addEventListener('change', function () {
          enableType('evening_reminder', eveningToggle.checked);
          var grp = document.getElementById('notif-evening-time-group');
          if (grp) grp.style.display = eveningToggle.checked ? '' : 'none';
        });
        // Reflect initial state of the time-group visibility
        var grp = document.getElementById('notif-evening-time-group');
        if (grp) grp.style.display = eveningToggle.checked ? '' : 'none';
      }
      if (eveningTimeInput) {
        var hh = String(_prefs.eveningReminder.hour).padStart(2, '0');
        var mm = String(_prefs.eveningReminder.minute).padStart(2, '0');
        eveningTimeInput.value = hh + ':' + mm;
        eveningTimeInput.addEventListener('change', function () {
          var parts = (eveningTimeInput.value || '22:00').split(':');
          if (parts.length === 2) {
            setReminderTime(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0);
          }
        });
      }
      if (morningToggle) {
        morningToggle.checked = _prefs.morningReminder.enabled;
        morningToggle.addEventListener('change', function () {
          enableType('morning_reminder', morningToggle.checked);
          var grpM = document.getElementById('notif-morning-time-group');
          if (grpM) grpM.style.display = morningToggle.checked ? '' : 'none';
        });
        var grpMInit = document.getElementById('notif-morning-time-group');
        if (grpMInit) grpMInit.style.display = morningToggle.checked ? '' : 'none';
      }
      if (morningTimeInput) {
        var mhh = String(_prefs.morningReminder.hour).padStart(2, '0');
        var mmm = String(_prefs.morningReminder.minute).padStart(2, '0');
        morningTimeInput.value = mhh + ':' + mmm;
        morningTimeInput.addEventListener('change', function () {
          var parts = (morningTimeInput.value || '07:00').split(':');
          if (parts.length === 2) {
            setMorningReminderTime(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0);
          }
        });
      }
      if (geoToggle) {
        geoToggle.checked = _prefs.geoReminder.enabled;
        geoToggle.addEventListener('change', function () {
          enableType('geo_reminder', geoToggle.checked);
        });
      }
      if (ruleToggle) {
        ruleToggle.checked = _prefs.ruleWarning.enabled;
        ruleToggle.addEventListener('change', function () {
          enableType('rule_warning', ruleToggle.checked);
        });
      }
      if (minijobToggle) {
        minijobToggle.checked = _prefs.minijobWarning.enabled;
        minijobToggle.addEventListener('change', function () {
          enableType('minijob_warning', minijobToggle.checked);
        });
      }

      // Reflect Notification permission state
      function _refreshPermissionUI() {
        if (!('Notification' in window)) {
          if (enableBtn) enableBtn.style.display = 'none';
          if (blockedHint) {
            blockedHint.textContent = '⚠️ Benachrichtigungen werden auf diesem Gerät nicht unterstützt.';
            blockedHint.style.display = '';
          }
          return;
        }
        if (Notification.permission === 'granted') {
          if (enableBtn) enableBtn.style.display = 'none';
          if (blockedHint) blockedHint.style.display = 'none';
        } else if (Notification.permission === 'denied') {
          if (enableBtn) enableBtn.style.display = 'none';
          if (blockedHint) blockedHint.style.display = '';
        } else {
          if (enableBtn) enableBtn.style.display = '';
          if (blockedHint) blockedHint.style.display = 'none';
        }
      }
      _refreshPermissionUI();

      if (enableBtn) {
        enableBtn.addEventListener('click', function () {
          if (!('Notification' in window)) return;
          try {
            Notification.requestPermission().then(_refreshPermissionUI);
          } catch (e) {
            Notification.requestPermission(function () { _refreshPermissionUI(); });
          }
        });
      }
    }

    /**
     * Schedule a setTimeout that fires at the next configured hour:minute.
     */
    function _scheduleNextEvening() {
      if (_eveningTimerId !== null) {
        clearTimeout(_eveningTimerId);
        _eveningTimerId = null;
      }
      if (!_prefs.eveningReminder.enabled) return;

      var now = new Date();
      var trigger = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                             _prefs.eveningReminder.hour, _prefs.eveningReminder.minute, 0, 0);
      if (trigger.getTime() <= now.getTime()) {
        // Past today's time — schedule for tomorrow
        trigger.setDate(trigger.getDate() + 1);
      }
      var ms = trigger.getTime() - now.getTime();
      // Cap at ~24h to avoid setTimeout overflow on edge cases
      if (ms > 86400000) ms = 86400000;
      _eveningTimerId = setTimeout(function () {
        _eveningTimerId = null;
        _triggerEveningReminder(false);
        _scheduleNextEvening();
      }, ms);
    }

    /**
     * Check whether we missed today's evening reminder (e.g., the PWA was
     * closed past the configured time on iOS). If so, fire it inline.
     */
    function _checkMissedReminder() {
      if (!_prefs.eveningReminder.enabled) return;
      var now = new Date();
      var todayKey = _todayKey(now);
      var triggerTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                                 _prefs.eveningReminder.hour, _prefs.eveningReminder.minute, 0, 0);
      if (now.getTime() < triggerTime.getTime()) return; // not past time yet

      var lastTrigger = null;
      try { lastTrigger = localStorage.getItem(LAST_TRIGGER_KEY); } catch (e) {}
      if (lastTrigger === todayKey) return; // already triggered today

      _triggerEveningReminder(true);
    }

    /**
     * Decide whether to send the reminder, then send it.
     * @param {boolean} viaCatchUp true if this is a catch-up after a missed time
     */
    function _triggerEveningReminder(viaCatchUp) {
      var todayKey = _todayKey(new Date());

      // Skip if user already logged hours today
      if (_hasLoggedToday(todayKey)) {
        try { localStorage.setItem(LAST_TRIGGER_KEY, todayKey); } catch (e) {}
        return;
      }

      try { localStorage.setItem(LAST_TRIGGER_KEY, todayKey); } catch (e) {}

      var title = 'JobTracker';
      var body = 'Heute schon Stunden eingetragen?';
      var options = {
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'jt-evening-reminder-' + todayKey
      };

      // Prefer service-worker registration (iOS PWA + Android compatible)
      if ('Notification' in window && Notification.permission === 'granted') {
        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(function (registration) {
            if (registration && typeof registration.showNotification === 'function') {
              registration.showNotification(title, options);
            } else {
              try { new Notification(title, options); } catch (e) {}
            }
          }).catch(function () {
            try { new Notification(title, options); } catch (e) {}
          });
        } else {
          try { new Notification(title, options); } catch (e) {}
        }
      }

      // Always also surface an in-app toast — covers the case where the PWA
      // was just opened and the OS-level notification is suppressed.
      if (typeof showToast === 'function' && viaCatchUp) {
        showToast('🕘 Heute schon Stunden eingetragen?', 6000);
      }
    }

    /**
     * Returns true if the user has any workday entry for the given YYYY-MM-DD.
     */
    function _hasLoggedToday(dateKey) {
      try {
        var workdays = (typeof AppState !== 'undefined' && AppState.getState)
          ? (AppState.getState().workdays || [])
          : [];
        for (var i = 0; i < workdays.length; i++) {
          if (workdays[i] && workdays[i].date === dateKey) return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    }

    /**
     * Record that the user logged hours today so we don't fire the reminder.
     */
    function _markLoggedToday() {
      var todayKey = _todayKey(new Date());
      try { localStorage.setItem(LAST_TRIGGER_KEY, todayKey); } catch (e) {}
    }

    function _todayKey(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    /**
     * Schedule a setTimeout that fires at the next configured morning time.
     * Mirrors _scheduleNextEvening: caps at 24h, re-schedules itself after
     * each fire.
     */
    function _scheduleNextMorning() {
      if (_morningTimerId !== null) {
        clearTimeout(_morningTimerId);
        _morningTimerId = null;
      }
      if (!_prefs.morningReminder.enabled) return;

      var now = new Date();
      var trigger = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                             _prefs.morningReminder.hour, _prefs.morningReminder.minute, 0, 0);
      if (trigger.getTime() <= now.getTime()) {
        trigger.setDate(trigger.getDate() + 1);
      }
      var ms = trigger.getTime() - now.getTime();
      if (ms > 86400000) ms = 86400000;
      _morningTimerId = setTimeout(function () {
        _morningTimerId = null;
        _triggerMorningReminder(false);
        _scheduleNextMorning();
      }, ms);
    }

    /**
     * Catch up if we missed today's morning reminder (e.g., the PWA was
     * suspended over the configured time on iOS). Fires inline if needed.
     */
    function _checkMissedMorning() {
      if (!_prefs.morningReminder.enabled) return;
      var now = new Date();
      var todayKey = _todayKey(now);
      var trigger = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                             _prefs.morningReminder.hour, _prefs.morningReminder.minute, 0, 0);
      if (now.getTime() < trigger.getTime()) return;

      var lastTrigger = null;
      try { lastTrigger = localStorage.getItem(LAST_MORNING_TRIGGER_KEY); } catch (e) {}
      if (lastTrigger === todayKey) return;

      _triggerMorningReminder(true);
    }

    /**
     * Build and dispatch the morning reminder. Skips silently when there are
     * no shifts (worked or pending) on today's date — but still records the
     * trigger so we don't recheck on every reopen.
     */
    function _triggerMorningReminder(viaCatchUp) {
      var todayKey = _todayKey(new Date());

      var todayShifts = _getTodayShifts(todayKey);
      if (todayShifts.length === 0) {
        try { localStorage.setItem(LAST_MORNING_TRIGGER_KEY, todayKey); } catch (e) {}
        return;
      }

      try { localStorage.setItem(LAST_MORNING_TRIGGER_KEY, todayKey); } catch (e) {}

      var body = '';
      if (todayShifts.length === 1) {
        var s = todayShifts[0];
        body = 'Heute: ' + (s.hours ? s.hours + 'h' : 'Schicht') + ' bei ' + s.jobName;
      } else {
        var totalHours = 0;
        for (var i = 0; i < todayShifts.length; i++) {
          if (todayShifts[i].hours) totalHours += parseFloat(todayShifts[i].hours);
        }
        body = 'Heute: ' + todayShifts.length + ' Schichten' + (totalHours ? ' (' + totalHours + 'h)' : '');
      }

      var title = '☀️ Guten Morgen';
      var options = {
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'jt-morning-reminder-' + todayKey
      };

      if ('Notification' in window && Notification.permission === 'granted') {
        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(function (registration) {
            if (registration && typeof registration.showNotification === 'function') {
              registration.showNotification(title, options);
            } else {
              try { new Notification(title, options); } catch (e) {}
            }
          }).catch(function () {
            try { new Notification(title, options); } catch (e) {}
          });
        } else {
          try { new Notification(title, options); } catch (e) {}
        }
      }

      if (typeof showToast === 'function' && viaCatchUp) {
        showToast('☀️ ' + body, 6000);
      }
    }

    /**
     * Returns an array of {hours, jobName} for every workday on the given
     * date that is in 'worked' or 'pending' status.
     */
    function _getTodayShifts(todayKey) {
      var workdays = [];
      try {
        workdays = (typeof AppState !== 'undefined' && AppState.getState)
          ? (AppState.getState().workdays || [])
          : [];
      } catch (e) { return []; }

      var jobs = [];
      try {
        jobs = (typeof AppState !== 'undefined' && AppState.getState)
          ? (AppState.getState().jobs || [])
          : [];
      } catch (e) { return []; }

      var jobMap = {};
      for (var j = 0; j < jobs.length; j++) {
        if (jobs[j] && jobs[j].id) jobMap[jobs[j].id] = jobs[j];
      }

      var result = [];
      for (var i = 0; i < workdays.length; i++) {
        var w = workdays[i];
        if (!w || w.date !== todayKey) continue;
        if (w.status !== 'worked' && w.status !== 'pending') continue;
        var job = jobMap[w.jobId];
        result.push({
          hours: w.hours,
          jobName: job ? job.employerName : 'Unbekannt'
        });
      }
      return result;
    }

    return {
      init: init,
      setReminderTime: setReminderTime,
      setMorningReminderTime: setMorningReminderTime,
      enableType: enableType,
      getPreferences: getPreferences,
      clearAll: clearAll
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

  // ─── App Version & Changelog ─────────────────────────────────────────────────
  const APP_VERSION = '3.1.2';
  const APP_CHANGELOG = [
    {
      version: '3.1.2',
      date: '2026-05-24',
      changes: [
        'v3.1.2 — Gradient schrumpft beim Scrollen statt zu verschwinden',
        '🌅 Beim Scrollen erscheint jetzt eine kompakte Leiste oben mit demselben Gradient wie der große Header (Warmth, Emerald, Sunset, Ocean, Lavender oder Monochrome)',
        '✨ Sanfter scroll-gebundener Fade statt eines harten Wechsels',
        '📝 Kleines „JobTracker"-Wordmark in der kompakten Leiste'
      ]
    },
    {
      version: '3.1.1',
      date: '2026-05-24',
      changes: [
        'v3.1.1 — Scroll-Away-Header & Brutto/Netto-Toggle gefixt',
        '🌅 Großer Gradient-Header scrollt jetzt natürlich mit — kein dauerhaft fixiertes Riesenpanel mehr',
        '🔘 Beim Scrollen erscheint eine kleine kompakte Leiste oben mit den runden Buttons (Theme & Info)',
        '💰 Bugfix: Tippen auf den Cashflow-Betrag schaltet jetzt korrekt zwischen Brutto- und Netto-Anzeige um (das Stepper-Update überschrieb den Wert vorher)'
      ]
    },
    {
      version: '3.1.0',
      date: '2026-05-24',
      changes: [
        'v3.1.0 — Großer Gradient-Header, Light Mode neu, Layout-Fixes',
        '🌅 Großer warmer Gradient-Header (~360px) — wählbar zwischen 6 Presets (Warmth, Emerald, Sunset, Ocean, Lavender, Monochrome)',
        '☀️ Light Mode komplett neu: warmes Off-White statt kaltes Blaugrau',
        '💰 Netto/Brutto-Toggle: Tippe auf den Cashflow-Betrag, um zwischen Netto und Brutto zu wechseln',
        '🏠 Homescreen aufgeräumt: Carousel-Navigation entfernt, Gesamtübersicht-Karte ist wieder zentral',
        '🏢 Job-Karten zeigen jetzt das Firmenlogo aus den Einstellungen',
        '🔵 Blaues Glow im Hintergrund entfernt — moderne flache Tab-Leiste',
        '✨ Aurora-Hintergrund-Blobs entfernt — sauberer iOS-26-Look',
        '🐛 Info-Button & Diverse Layout-Bugs behoben'
      ]
    },
    {
      version: '3.0.0',
      date: '2026-05-24',
      changes: [
        'v3.0.0 — Major Rebranding (Version 3.0)',
        '🏠 Schwebende Navigation: Drei schwebende, kreisrunde Buttons (Home 🏠, Eintragen ➕, Einstellungen ⚙️) unten im Viewport sorgen für ein erstklassiges App-Gefühl und vergrößern sich beim Anklicken sanft',
        '🌌 Großer Gradient-Header: Die Kopfzeile glänzt mit einem riesigen, wunderschönen, fließenden Pastel-Verlaufshintergrund mit eleganten 32px-Abrundungen',
        '☀️ Dunkel/Hell-Toggle: Direkter circularer Theme-Wechsler (Sonne ☀️ / Mond 🌙) oben links zum schnellen Umschalten der Helligkeit',
        'ℹ️ Circularer Info-Button: Oben rechts platziert, um sämtliche Gesetze, Arbeitszeitregeln und Familienversicherungsgrenzen blitzschnell anzuzeigen',
        '⏰ Dynamische Begrüßung: Die persönliche Begrüßung passt sich automatisch der aktuellen Uhrzeit auf Deutsch an (Guten Morgen, Guten Tag, Guten Abend, Gute Nacht)',
        '🔄 Endloser Home-Karussell: Navigiere kinderleicht per Pfeile (‹ / ›) endlos schleifenweise durch die Übersicht, den Monat und das Jahr',
        '💳 Netto-Cashflow Balance Card: Prominente Platzierung deines monatlichen Netto-Cashflows als Kontostand direkt im Gradient-Header',
        '📊 Kompakter Brutto/Stunden-Streifen: Die Brutto- und Stundenwerte werden in einem schlanken Querstreifen im Dashboard präsentiert'
      ]
    },
    {
      version: '2.8.0',
      date: '2026-05-24',
      changes: [
        'v2.8.0 — Premium Web 3.0 Design-Revamp',
        '🌌 Ambiance Auroras: Sanft leuchtende, fixierte Amber- und Teal-Hintergrundeffekte (Radial Glow) sorgen für ein faszinierendes Tiefengefühl',
        '💎 Obsidian-Glasmorphismus: Sämtliche App-Karten wurden in hochtransparente, tief verschwommene (blur: 24px) dunkle Paneele mit filigranen Borders (rgba 255/255/255/0.05) und weichen Schatten umgestaltet',
        '🌟 Dashboard-Highlight-Glow: Die Gesamtübersicht-Karte glänzt nun mit einem edlen, dynamisch leuchtenden Teal-Verlaufshintergrund',
        '🧭 Dynamic Island Header: Das Kopfzeilenmenü wurde in eine schwebende, hochauflösende Dynamic Island Bar umgewandelt',
        '📱 Apple Native Design: Beibehaltung der standardmäßigen, gestochen scharfen iOS-Systemschriftarten für das ultimative PWA-Gefühl',
        '💊 Visuelle Kapseln: Urlaub, Krankheit und rechtliche Warnungen werden jetzt in eleganten, farbig akzentuierten Pillen und Statuskapseln dargestellt'
      ]
    },
    {
      version: '2.7.1',
      date: '2026-05-24',
      changes: [
        'v2.7.1 — Klappbarer Steuer-Simulator & iOS Touch-Fixes',
        '📂 Klappbares Design: Simulator-Panel einklappbar, im geschlossenen Zustand wird eine schicke, kompakte Zusatz-Stunden- und Geld-Zusammenfassung angezeigt',
        '🚫 Slider-Bereinigung: Störende orange stündliche Blasenanzeige im Slider-Track vollständig entfernt für sauberes Layout',
        '📳 Doppelklick- & Scroll-Schutz: Deaktivierung des Safari double-tap Delays mittels touch-action: manipulation; verhindert Verrutschen des Bildschirms bei schnellem Klicken',
        '📊 Prognose entfernt: Das Dashboard-Prognose-Widget wurde komplett entfernt für einen aufgeräumteren Look',
        '⚙️ Event-Isolation: Klick-Ereignisse auf Buttons, Regler und Reset-Felder isoliert (e.stopPropagation()), sodass kein versehentliches Einklappen getriggert wird',
        '📋 Einzeiliger Info-Text: Keine unschönen Zeilenumbrüche mit einzelnen Worten mehr im Simulator-Footer dank Ellipsis-Kürzung'
      ]
    },
    {
      version: '2.7.0',
      date: '2026-05-24',
      changes: [
        'v2.7.0 — Premium Steuer-Simulator & iOS PWA-Splash-Screens',
        '💶 Steuer-Simulator Redesign: Separates glasmorphisches Panel unter den Stats mit vollem Slider-Umfang von 0 bis +maxDelta (keine Minuswerte mehr)',
        '📱 iOS Safe-Area & PWA-Optimierung: Responsive, hochauflösende SVG-Splash-Screens für alle gängigen iPhones beim Starten vom Home-Bildschirm',
        '📊 Intelligente Limits: Simulator skaliert dynamisch bis max. 160 Std. Gesamtstunden für Stundenlohn-Empfänger',
        '📅 Tagessatz-Unterstützung: Erkennt Tagessatz-Jobs automatisch, zeigt „Tage“ statt „Stunden“ an und simuliert zusätzliche Arbeitstage bis zum Monatsende',
        '🔘 Tactile Touch Controls: Circular Stepper-Buttons (44x44px), reaktiver Reset-Button und fließende Bubble-Positionierung',
        '📳 Haptisches Slider-Feedback: Physische Vibrations-Ticks beim Verstellen des Reglers auf unterstützten Geräten'
      ]
    },
    {
      version: '2.6.0',
      date: '2026-05-24',
      changes: [
        'v2.6.0 — Tatsächlich/Projiziert-Toggle, Stunden-Simulator, Steuer-Simulator entfernt',
        '⚡ Gesamtübersicht: Neuer Toggle "Tatsächlich" ↔ "Projiziert" zeigt Brutto/Netto inklusive ausstehender Schichten (erscheint nur wenn Pending-Einträge vorhanden)',
        '🔢 Stunden-Stepper in der Gesamtübersicht: ▲▼-Buttons neben den Stunden für What-If-Simulation, Brutto/Netto aktualisieren live',
        '↺ Zurücksetzen-Button bringt die Simulation auf die tatsächlichen Stunden zurück',
        '🗑️ Steuer-Simulator-Widget entfernt — Funktion ist jetzt direkt in der Gesamtübersicht integriert'
      ]
    },
    {
      version: '2.5.0',
      date: '2026-06-09',
      changes: [
        'v2.5.0 — Ausstehende Schichten, Morgens-Erinnerung & Stat-Anzeige',
        '⏳ ICS-Import erkennt Schichten in der Zukunft jetzt als „Ausstehend" — sie zählen erst nach Bestätigung in Brutto/Netto',
        '✅/❌ „Letzte Einträge" zeigt für ausstehende Einträge zwei Aktionsbuttons: grün ✓ bestätigt die Schicht, rot ✕ entfernt sie',
        '☀️ Neue Morgens-Erinnerung in den Einstellungen — wird nur ausgelöst wenn heute eine Schicht eingeplant ist',
        '💶 Gesamtübersicht: Brutto/Netto werden bei großen Beträgen nicht mehr abgeschnitten (kleinere Schrift, tabellarische Ziffern)'
      ]
    },
    {
      version: '2.4.1',
      date: '2026-06-08',
      changes: [
        'v2.4.1 — ICS-Import: ein Eintrag pro Tag (Match nur per Datum)',
        '📅 Kalender-Import: Pro Job und Datum existiert ab jetzt nur noch ein Eintrag — bestehende Einträge werden beim Re-Import überschrieben',
        '🔁 Idempotenter Re-Import: Mehrfaches Importieren derselben .ics-Datei erzeugt keine Duplikate mehr',
        '🛠️ Match-Logik: Statt (Job + Datum + Startzeit) wird nur noch (Job + Datum) zur Erkennung bestehender Einträge verwendet'
      ]
    },
    {
      version: '2.4.0',
      date: '2026-06-07',
      changes: [
        'v2.4.0 — Historie-Filter & Abrechnungszeitraum',
        '🔍 „Letzte Einträge": Neuer Filter — Alle, Aktueller Monat (Standard), Letzter Monat oder ein konkreter Monat aus den letzten 12 Monaten',
        '📋 Liste zeigt jetzt ALLE Einträge des gewählten Zeitraums (kein 10er-Limit mehr) und scrollt innerhalb derselben Karten-Höhe',
        '📅 Monat-Tab „Tag für Tag": Einträge werden pro Job nach Abrechnungszeitraum gefiltert — bei Abrechnungstag = 20 erscheint ein Eintrag vom 25. Mai jetzt im Juni',
        '🏷️ Titel zeigt „Tag für Tag (Abrechnungszeitraum)" wenn mindestens ein Job einen Abrechnungstag konfiguriert hat'
      ]
    },
    {
      version: '2.3.0',
      date: '2026-06-06',
      changes: [
        'v2.3.0 — Einträge bearbeiten',
        '✏️ Tippe in „Letzte Einträge" auf einen Eintrag, um ihn zu bearbeiten — Stunden, Status, Datum, Job, Provision, Trinkgeld und Notizen lassen sich anpassen',
        '💰 Beim Speichern werden Provision und Trinkgeld vollständig ersetzt und Brutto/Netto neu berechnet',
        '🔁 „Abbrechen"-Button verlässt den Bearbeitungsmodus ohne Speichern',
        '🎯 Visuelle Hervorhebung des Formulars im Bearbeitungsmodus'
      ]
    },
    {
      version: '2.2.1',
      date: '2026-06-05',
      changes: [
        'v2.2.1 — Sub-Nav als fixed bar — bleibt zuverlässig unter dem Header',
        '🧭 Sub-Tabs (Übersicht/Monat/Jahr): Jetzt als fixierte Leiste direkt unter dem Header — bleibt auf iOS Safari zuverlässig oben sichtbar (sticky war unzuverlässig)',
        '🎯 Eine geteilte Sub-Nav für alle Tracking-Ansichten statt drei separate Leisten',
        '📐 Inhalts-Padding wird dynamisch an die Höhe von Header + Sub-Nav angepasst'
      ]
    },
    {
      version: '2.2.0',
      date: '2026-06-04',
      changes: [
        'v2.2.0 — Sub-Tab Fix, Kalender-Import (.ics)',
        '🧭 Sub-Tabs (Übersicht/Monat/Jahr): Bleiben jetzt sichtbar unter dem Header beim Scrollen — auch in KFB- und anderen Job-Ansichten',
        '📅 Kalender-Import: Schichten aus .ics-Dateien (iCloud, Google Calendar, Outlook) übernehmen',
        '🔄 ICS-Reimport: Bestehende Einträge mit gleichem Datum + Startzeit werden aktualisiert statt dupliziert',
        '🛡️ Append-Modus: Manuell erfasste Einträge bleiben beim Import erhalten'
      ]
    },
    {
      version: '2.1.5',
      date: '2026-06-03',
      changes: [
        'v2.1.5 — Flat Tax Tile, Centered Punch Clock, Remove Progress Bar, Fix Fertig Button',
        '📊 Prognose: Fortschrittsbalken aus Minijob-Forecast entfernt',
        '🤒 Krankheitstage: Vertikale Zentrierung zwischen Trennlinien korrigiert',
        '💶 Steuer-Simulator: Flaches Design — kein Glaseffekt, kein Shimmer, moderater Radius',
        '✓ Fertig-Button: Erscheint nur noch im Bearbeitungsmodus (kein Anzeigen bei Pull-to-Refresh)',
        '⏱️ Punch Clock: Zentriertes vertikales Layout, SVG-Icons, Überspringen-Option, kein Gloss'
      ]
    },
    {
      version: '2.1.4',
      date: '2026-06-02',
      changes: [
        'v2.1.4 — Punch Clock → Eintragen, Steuer-Simulator klappbar, Layout-Fixes',
        '⏱️ Punch Clock: Verschoben in den Eintragen-Tab als volle Breite (horizontal)',
        '💶 Steuer-Simulator: Klappbar — zeigt Netto-Delta im Header, Tap zum Öffnen/Schließen',
        '📐 Eintragen-Titel: Korrekte Ausrichtung mit Inhaltsblöcken',
        '🗑️ "Bald verfügbar" Text in Gesamtübersicht entfernt',
        '➖ Krankheitstage: Doppelte Linie entfernt (nur noch eine Trennlinie)',
        '📍 Geo-Adresseingabe: Layout korrigiert — Eingabefeld volle Breite, Button 44×44px'
      ]
    },
    {
      version: '2.1.3',
      date: '2026-06-01',
      changes: [
        'v2.1.3 — Text-Selektion, Adress-Geocoding, Ring-Zentrierung, Krankheitstage, Provision',
        '🚫 Long-Press: iOS Text-Selektion auf Widgets verhindert',
        '📍 Geo-Erinnerung: Adresseingabe statt Koordinaten, automatisches Geocoding via OpenStreetMap',
        '⏱️ Punch-Clock: Ring exakt zentriert (absolute Positionierung für Titel & Bottom)',
        '🤒 Gesamtübersicht: Krankheitstage-Zeile vertikal zentriert zwischen Linien',
        '💰 Job-Karten: Provision wird im Berechnungs-Breakdown angezeigt (z.B. 8h × 12€/Std + 80€ Prov.)'
      ]
    },
    {
      version: '2.1.2',
      date: '2026-05-31',
      changes: [
        'v2.1.2 — Long-Press Reorder, Stable Punch, Tab Font, Drag Scroll Fix',
        '🔄 Dashboard: "Anordnen"-Button entfernt — Widgets per Long-Press (500ms) neu anordnen',
        '✓ "Fertig"-Pill oben rechts zum Beenden des Bearbeitungsmodus',
        '⏱️ Punch-Clock: Stabiles Layout — Tile ändert nie die Größe, Ring bleibt zentriert',
        '📋 Letzte Einträge: Exakt 5 Einträge sichtbar ohne Abschneiden',
        '🧭 Tabs: Emojis entfernt, kleinere Schrift — "Einstellungen" passt jetzt komplett',
        '↕️ Widget-Drag: Scrolling wird beim Ziehen korrekt blockiert (kein Hochscrollen mehr)'
      ]
    },
    {
      version: '2.1.1',
      date: '2026-05-30',
      changes: [
        'v2.1.1 — Header, Pull-Refresh, Toasts, Punch & History Polish',
        '🧭 Header: Logo zentriert, Header bleibt beim Scrollen IMMER sichtbar (fixed statt sticky)',
        '👆 Pull-to-Refresh: Aktiviert nur noch beim Pullen NACH UNTEN VOM TOP — Scrollen nach oben funktioniert wieder normal',
        '🎯 Toasts: Neues iOS-Design mit Icon, Glas-Hintergrund, dezentem Schatten — mehrere Toasts stapeln sich sauber',
        '⏱️ Punch-Clock: Ring + Label sind jetzt sauber zentriert — keine fette Lücke mehr im Idle-Zustand',
        '📋 Letzte Einträge: Maximal 5 Einträge sichtbar, der Rest scrollt innerhalb der Liste'
      ]
    },
    {
      version: '2.1.0',
      date: '2026-05-29',
      changes: [
        'v2.1.0 — Top-Navigation, neuer Steuer-Simulator',
        '🧭 Navigation: Tabs sind jetzt oben in der Sticky-Header-Leiste — kein Bottom-Nav mehr',
        '💶 Steuer-Simulator: Neuer Look mit aktuellem & neuem Brutto/Netto, Slider bis +160h, große Netto-Differenz',
        '⏱️ Punch-Clock: Ring bleibt beim Schichtstart in fester Position (kein Springen mehr)',
        '⚙️ Einstellungen: "Version & Updates" steht jetzt ganz oben'
      ]
    },
    {
      version: '2.0.7',
      date: '2026-05-28',
      changes: [
        'v2.0.7 — Punch-Layout, optionale Extras, History, Light-Mode',
        '⏱️ Punch-Clock: Aktive Schicht zeigt Stop-Icon im Ring + großen Timer mit "läuft seit" Label darunter (kein Quetschen mehr)',
        '✅ Punch-Extras: "Bestätigen" speichert Schicht auch ohne Trinkgeld/Provision (0 €). "Überspringen" verwirft die Schicht komplett',
        '📋 "Letzte Einträge": Kein max-height mehr — Liste scrollt mit dem View, jeder Eintrag mit konstanter Mindesthöhe',
        '🐛 Header: Grauer Balken beim Scrollen entfernt (border-bottom + Surface-Background)',
        '☀️ Light-Mode: Punch-Ring und Steuer-Slider sind jetzt sichtbar (dunklere Tracks statt weiß-auf-weiß)',
        '💶 Steuer-Tile kompakter: Betrag 20px, Slider-Thumb 24px, engerer Innenabstand'
      ]
    },
    {
      version: '2.0.6',
      date: '2026-05-27',
      changes: [
        'v2.0.6 — Punch-Layout, Steuer-Info, Grauer Balken, History, Zeitpicker',
        '⏱️ Punch-Clock: Timer + Stop-Icon sauber gestapelt (Icon kleiner, Timer größer)',
        '💶 Steuer-Simulator: Info-Label zeigt Berechnungsbasis (Werkstudent/Minijob/Stkl.)',
        '🎚️ Steuer-Simulator: Slider funktioniert beim Wischen über den ganzen Bildschirm',
        '🐛 Grauer Balken über Navigation entfernt (border-top)',
        '📋 Punch-Einträge erscheinen jetzt in "Letzte Einträge" beim Tab-Wechsel',
        '🎨 Benachrichtigungs-Zeitpicker auf normale Größe angepasst'
      ]
    },
    {
      version: '2.0.5',
      date: '2026-05-26',
      changes: [
        'v2.0.5 — Punch UX, smoother reorder, iOS pull-refresh, tax accuracy',
        '⏱️ Punch-Clock: Label unter dem Ring (kein Überlappen mehr), dezenter Glow + Tiefeneffekt am Ring, Idle-Pulse-Animation am Button',
        '⏱️ Punch-Clock: Inline Trinkgeld/Provision-Eingabe nach Schichtende (wenn für den Job aktiviert)',
        '👆 Dashboard-Reorder: GPU-beschleunigt (translate3d), Clone nur einmal bei Drag-Start, rAF-Debounce für flüssigere Vorschau',
        '🔄 Pull-to-Refresh: iOS-Style Spinner statt Text, progressives Erscheinen beim Ziehen, deaktiviert im Edit-Modus',
        '🎚️ Steuer-Simulator: Größerer Slider-Thumb (28px) für bessere iOS-Touch-Bedienung',
        '✅ Steuer-Berechnung verifiziert: Netto-Delta korrekt mit progressiver Besteuerung, glatte Kurve ohne Sprünge'
      ]
    },
    {
      version: '2.0.4',
      date: '2026-05-25',
      changes: [
        'v2.0.4 — Dashboard-Grid, Punch-Clock & Steuer-Simulator',
        '🧱 Dashboard im 2-Spalten-Grid: Punch-Clock & Steuer-Simulator als 1×1-Glaskacheln nebeneinander, alle anderen Widgets über volle Breite. Reihenfolge wird automatisch im Grid platziert',
        '👆 Drag&Drop komplett neu: iOS-Home-Screen-Stil mit FLIP-Preview, Slot-basiertem Hit-Test und sauberen Swaps — keine seltsamen Andock-Effekte mehr',
        '⏱️ Punch-Clock kreisrund: zentraler Play/Stop-Button, Fortschrittsring (8h voll), Farbwechsel ins Warme nach 8h Schicht, Timer im Inneren',
        '💶 Steuer-Simulator als Kompakt-Kachel: kein Aufklappen mehr, Big-Net-Anzeige, schlanker Slider, Steuersatz unten',
        '🐛 Steuer-Berechnung präzisiert: progressive deutsche Lohnsteuer 2026 in 4 Zonen ohne Cliff-Sprünge, Soli mit korrekter Milderungszone (smoothes Phase-In zwischen 18.130€ und 36.260€)',
        '✅ Verifiziert: Schieberegler von 68h → 69h → 70h erzeugt jetzt gleichmäßige Netto-Schritte, keine Soli-Klippe'
      ]
    },
    {
      version: '2.0.3',
      date: '2026-05-24',
      changes: [
        'v2.0.3 — iOS-Polish & Notifications',
        '🎨 Dashboard-Anordnen komplett neu: iOS-Home-Screen-Stil mit Slot-Swap, FLIP-Animation und Touch-Tracking — Widgets verschwinden nicht mehr beim Verschieben',
        '🎨 Punch-Clock im iOS 26 Material-Design: Glas-Karte, Vibrant-Buttons mit Soft-Highlight, springige Press-Animation, größere Tabular-Nums-Uhr',
        '🐛 Swipe-to-Delete: Zurück-Animation läuft jetzt sauber — Inline-Transform wird vor Klassenwechsel geleert, kein Konflikt mehr; iOS-typisches Easing (cubic-bezier 0.32, 0.72, 0, 1)',
        '📱 Haptisches Feedback: Auf iOS Safari (und anderen Geräten ohne Vibration-API) komplett ausgeblendet statt mit Hinweis angezeigt',
        '🔔 Neue Benachrichtigungs-Einstellungen: Tägliche Abend-Erinnerung mit Uhrzeit, globale Toggles für Standort/Regel/Minijob, Berechtigung anfordern direkt aus den Settings'
      ]
    },
    {
      version: '2.0.2',
      date: '2026-05-23',
      changes: [
        'v2.0.2 — Reorder/Tax/Swipe Fixes',
        '🎨 Dashboard-Anordnen: iOS-Style Wiggle-Animation, sauberer Akzent-Glow statt gestrichelter Outlines',
        '👆 Dashboard-Anordnen: Pointer-basiertes Live-Drag auf Touch (HTML5 DnD ist auf iOS Safari unzuverlässig)',
        '🐛 Steuer-Simulator: Nutzt jetzt IncomeEngine direkt — keine Soli-Klippe mehr zwischen 69h und 70h, korrekte Berücksichtigung von Steuerklasse, Bundesland, KV-Typ und Kirchensteuer',
        '🐛 Swipe-to-Delete: Wischen nach rechts schließt jetzt zuverlässig (deltaX wurde nur in eine Richtung erkannt)',
        'ℹ️ Haptisches Feedback: Klarer iOS-Hinweis (Apple-Beschränkung) statt generischer Warnung; Toggle bleibt aktivierbar'
      ]
    },
    {
      version: '2.0.1',
      date: '2026-05-22',
      changes: [
        'v2.0.1 — Bugfixes & Polish',
        '🐛 Tax-Simulator: Slider liest jetzt korrekt den Stundenlohn (defaultHourlyRate) und reagiert wieder auf Eingaben',
        '🐛 Sparklines: Re-Render bei Navigation auf "Übersicht" wieder funktionsfähig (viewId-Payload)',
        '🐛 Dashboard-Reorder: Anwendung der gespeicherten Reihenfolge bei Navigation gefixt',
        '🐛 RuleChecker: Aktiviert sich nun auch über das navigation:change-Event mit viewId',
        '🔔 Push-Notifications: Geo-Erinnerungen & Test-Benachrichtigung nutzen registration.showNotification() (Android-PWA)',
        '🎨 Punch-Clock: Größerer Timer mit Tabular-Nums, Schicht-Karte mit radius-lg + Schatten'
      ]
    },
    {
      version: '2.0.0',
      date: '2026-05-22',
      changes: [
        '⏱️ Punch Clock: One-Tap Schicht starten/beenden mit Timer',
        '📍 Geo-Erinnerungen: Automatische Benachrichtigung beim Verlassen des Arbeitsplatzes',
        '📈 Sparklines: Trend-Diagramme für Trinkgeld & Provision',
        '⚠️ Live-Warnungen: Werkstudent 20h/Woche & Minijob 603€/Monat Limits',
        '🔮 Minijob-Prognose: Jahresgrenze (7.236€) im Blick behalten',
        '💰 Steuer-Simulator: Brutto-Netto-Slider für Zusatzstunden',
        '📳 Haptisches Feedback: Vibration bei wichtigen Aktionen',
        '👆 Swipe-to-Delete: Einträge durch Wischen löschen',
        '💀 Skeleton Loading: Moderne Lade-Animationen',
        '🔄 Pull-to-Refresh: Runterziehen zum Aktualisieren'
      ]
    },
    {
      version: '1.9.0',
      date: '2026-05-21',
      changes: [
        '⚡ Vorlagen-System: "Neue Vorlage erstellen" → Formular wechselt in Vorlage-Modus',
        '⚡ Vorlage antippen = Eintrag wird sofort für heute eingetragen (Auto-Submit)',
        '🎨 Tab-Bubbles (Liquid Glass) gleichmäßig zentriert'
      ]
    },
    {
      version: '1.8.0',
      date: '2026-05-21',
      changes: [
        '🐛 KFB-Tage werden jetzt über ALLE KFB-Jobs zusammengezählt (70-Tage-Regel)',
        '🐛 Familienversicherung: KFB-Einkommen zählt nicht zur 565€-Grenze',
        '⚡ Templates: Ein Tap = automatisch eingetragen (kein manuelles Speichern mehr)',
        '📂 Job-Cards einklappbar (Tap auf Header zum Ein-/Ausklappen)',
        'Tab-Bubbles gleichmäßig zentriert'
      ]
    },
    {
      version: '1.7.0',
      date: '2026-05-20',
      changes: [
        '⚡ Schichtvorlagen: speichert Job + Stunden + Provision + Tagessatz',
        'Tab-Bubbles gleichmäßig zentriert (mehr Platz oben)',
        'Updates werden jetzt nach 1x Schließen aktiv'
      ]
    },
    {
      version: '1.6.0',
      date: '2026-05-20',
      changes: [
        '🔴 Familienversicherung-Warnung mit Fortschrittsbalken (565€/603€ Grenze)',
        '📊 Einkommensprognose: "Bei diesem Tempo verdienst du ca. X€"',
        '⚡ Schichtvorlagen: Schnelleintrag mit gespeicherten Templates',
        'Changelog-Banner bleibt jetzt sichtbar bis "Verstanden" geklickt wird'
      ]
    },
    {
      version: '1.5.0',
      date: '2026-05-20',
      changes: [
        'Familienversicherung als Krankenversicherungs-Option',
        'Keine KV/PV-Abzüge bei Familienversicherung',
        'Einkommensgrenze-Warnung (565 €/Monat bzw. 603 € bei Minijob)',
        'Regeln in der ℹ️ Info-Übersicht ergänzt'
      ]
    },
    {
      version: '1.4.0',
      date: '2026-05-20',
      changes: [
        'Neue Gehaltsart: Tagessatz — individueller Betrag pro Arbeitstag',
        'Job-Cards zeigen Daten passend zum Gesamtübersicht-Toggle',
        'Monats-Tab: Tage absteigend sortiert (neueste oben)',
        'Logo-Linie im Hell-Modus sichtbar'
      ]
    },
    {
      version: '1.3.0',
      date: '2026-05-20',
      changes: [
        'Gesamtübersicht zeigt aktuellen Abrechnungszeitraum (Toggle für Gesamt)',
        'Monats-Tab: Tage nach Datum absteigend sortiert',
        'Logo-Linie im Hell-Modus sichtbar',
        'Liquid Glass Tabs vergrößert'
      ]
    },
    {
      version: '1.2.0',
      date: '2026-05-20',
      changes: [
        'Liquid Glass Tab-Indikator (iOS 26 Stil)',
        'Firmenlogo via Website-Feld',
        'Abrechnungstag pro Job einstellbar',
        'Datum-Pfeile im Eintragen-Tab',
        'Einträge löschen in "Letzte Einträge"',
        'Akzentfarben funktionieren jetzt überall',
        'PWA Install-Anleitung für Safari',
        'Auto-Updates ohne Neuinstallation'
      ]
    },
    {
      version: '1.1.0',
      date: '2026-05-19',
      changes: [
        'Neuer Eintragen-Tab (getrennt von Übersicht)',
        'Brutto/Netto-Rechner mit Abzüge-Details',
        'Arbeitsrecht-Info über ℹ️ Button',
        'Hell/Dunkel-Modus mit Akzentfarben',
        'Monats- und Jahresübersicht',
        'Job-Kombinationsregeln (Greying-out)'
      ]
    },
    {
      version: '1.0.0',
      date: '2026-05-18',
      changes: [
        'Erste Version: Onboarding, Job-Verwaltung, Zeiterfassung',
        'Steuerberechnung für alle Jobarten (2026 Deutschland)',
        'Minijob/KFB/Werkstudent Limit-Überwachung'
      ]
    }
  ];

  /**
   * Checks if the app version changed and shows the update banner.
   */
  function _checkForVersionUpdate() {
    var lastVersion = AppState.get('lastSeenVersion');
    if (lastVersion && lastVersion !== APP_VERSION) {
      // Version changed — show update banner
      var currentChangelog = APP_CHANGELOG.find(function (c) { return c.version === APP_VERSION; });
      if (currentChangelog) {
        var bannerEl = document.getElementById('update-banner');
        var bodyEl = document.getElementById('update-banner-body');
        if (bannerEl && bodyEl) {
          var html = '<strong>Version ' + APP_VERSION + '</strong><ul>';
          for (var i = 0; i < currentChangelog.changes.length; i++) {
            html += '<li>' + currentChangelog.changes[i] + '</li>';
          }
          html += '</ul>';
          bodyEl.innerHTML = html;
          bannerEl.style.display = '';
          // Save version only when banner is dismissed
          return; // Don't save yet
        }
      }
    }
    // No update or no banner — save version immediately
    AppState.set('lastSeenVersion', APP_VERSION);
  }

  /**
   * Renders the changelog in the settings view.
   */
  function _renderSettingsChangelog() {
    var versionEl = document.getElementById('settings-app-version');
    var contentEl = document.getElementById('settings-changelog-content');
    if (versionEl) versionEl.textContent = APP_VERSION;
    if (contentEl) {
      var html = '';
      for (var i = 0; i < APP_CHANGELOG.length; i++) {
        var entry = APP_CHANGELOG[i];
        html += '<h4>v' + entry.version + ' — ' + entry.date + '</h4><ul>';
        for (var j = 0; j < entry.changes.length; j++) {
          html += '<li>' + entry.changes[j] + '</li>';
        }
        html += '</ul>';
      }
      contentEl.innerHTML = html;
    }
  }

  // ─── Service Worker Registration (Req 19.2) ────────────────────────────────
  function _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(function (registration) {
        // Check for updates on every page load
        registration.update();

        // When a new SW is waiting, tell it to activate immediately
        registration.addEventListener('updatefound', function () {
          var newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New SW installed while old one is still active — activate it
                newWorker.postMessage('skipWaiting');
              }
            });
          }
        });
      }).catch(function () {});

      // When the new SW takes control, reload to get fresh assets
      // The version check has already saved lastSeenVersion by this point,
      // so the changelog banner will show correctly after reload.
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

    // ── Header & Sub-Nav height CSS variables (kept in sync with fixed bars) ──
    _setHeaderHeightVar();
    _setSubNavHeightVar();
    window.addEventListener('resize', function () {
      _setHeaderHeightVar();
      _setSubNavHeightVar();
    });
    window.addEventListener('orientationchange', function () {
      // Defer one tick so the layout settles
      setTimeout(function () { _setHeaderHeightVar(); _setSubNavHeightVar(); }, 50);
      setTimeout(function () { _setHeaderHeightVar(); _setSubNavHeightVar(); }, 250);
    });

    // ── Phase 2.5: v2.0 Utility Modules ──
    HapticFeedbackService.init();
    SkeletonLoader.init();
    SwipeHandler.init();
    PullRefreshHandler.init();
    SparklineRenderer.init();
    PunchClock.init();
    RuleChecker.init();
    MinijobForecastWidget.init();
    GeoReminderService.init();
    DashboardOrderManager.init();
    NotificationScheduler.init();

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

    // ── Settings: Test Vibration & Test Notification buttons ──
    var hapticTestBtn = document.getElementById('haptic-test-btn');
    if (hapticTestBtn) {
      hapticTestBtn.addEventListener('click', function () {
        if (typeof HapticFeedbackService !== 'undefined') {
          if (!HapticFeedbackService.isSupported()) {
            showToast('Vibration wird auf diesem Gerät nicht unterstützt.', 4000);
            return;
          }
          if (!HapticFeedbackService.isEnabled()) {
            showToast('Haptisches Feedback ist deaktiviert. Bitte aktivieren.', 4000);
            return;
          }
          HapticFeedbackService.tap(80);
          setTimeout(function () { HapticFeedbackService.doublePulse(); }, 250);
          showToast('Vibration ausgelöst. Hat es funktioniert?', 3000);
        }
      });
    }

    var notificationTestBtn = document.getElementById('notification-test-btn');
    if (notificationTestBtn) {
      notificationTestBtn.addEventListener('click', function () {
        if (!('Notification' in window)) {
          showToast('Benachrichtigungen werden auf diesem Gerät nicht unterstützt.', 4000);
          return;
        }
        var sendTestNotification = function () {
          var options = {
            body: 'Test-Benachrichtigung. Wenn du das siehst, funktionieren Push-Nachrichten ✅',
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            tag: 'jt-test-notification'
          };
          // Prefer service-worker registration (Android PWA compatibility)
          if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(function (registration) {
              if (registration && typeof registration.showNotification === 'function') {
                registration.showNotification('JobTracker', options);
              } else {
                try { new Notification('JobTracker', options); }
                catch (e) { showToast('Test-Benachrichtigung fehlgeschlagen: ' + e.message, 4000); }
              }
            }).catch(function () {
              try { new Notification('JobTracker', options); }
              catch (e) { showToast('Test-Benachrichtigung fehlgeschlagen: ' + e.message, 4000); }
            });
          } else {
            try {
              new Notification('JobTracker', options);
            } catch (e) {
              showToast('Test-Benachrichtigung fehlgeschlagen: ' + e.message, 4000);
            }
          }
        };
        if (Notification.permission === 'granted') {
          sendTestNotification();
        } else if (Notification.permission === 'denied') {
          showToast('Benachrichtigungen sind blockiert. Bitte in den Browser-Einstellungen erlauben.', 5000);
        } else {
          try {
            Notification.requestPermission().then(function (permission) {
              if (permission === 'granted') {
                sendTestNotification();
              } else {
                showToast('Berechtigung verweigert.', 4000);
              }
            });
          } catch (e) {
            // Older browsers
            Notification.requestPermission(function (permission) {
              if (permission === 'granted') sendTestNotification();
              else showToast('Berechtigung verweigert.', 4000);
            });
          }
        }
      });
    }

    // ── Header Rules Info Button ──
    var rulesInfoBtn = document.getElementById('header-rules-info-btn');
    var rulesInfoModal = document.getElementById('rules-info-modal');
    var rulesInfoCloseBtn = document.getElementById('rules-info-close-btn');
    if (rulesInfoBtn && rulesInfoModal && !rulesInfoBtn._rulesInfoBound) {
      rulesInfoBtn._rulesInfoBound = true;
      rulesInfoBtn.addEventListener('click', function() {
        rulesInfoModal.classList.add('active');
        document.body.classList.add('modal-open');
        if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.micro) {
          HapticFeedbackService.micro();
        }
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

    // ── V3.1.1: Compact-bar duplicate buttons (same handlers as the big header) ──
    var headerThemeToggleCompact = document.getElementById('header-theme-toggle-btn-compact');
    if (headerThemeToggleCompact && !headerThemeToggleCompact._compactBound) {
      headerThemeToggleCompact._compactBound = true;
      var updateCompactIcon = function () {
        var current = ThemeManager.getTheme();
        var isDark = (current === 'dark' || (current === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
        headerThemeToggleCompact.textContent = isDark ? '☀️' : '🌙';
      };
      headerThemeToggleCompact.addEventListener('click', function () {
        var current = ThemeManager.getTheme();
        var next = (current === 'dark') ? 'light' : 'dark';
        ThemeManager.setTheme(next);
        updateCompactIcon();
        // Sync the big-header icon too
        var bigBtn = document.getElementById('header-theme-toggle-btn');
        if (bigBtn) bigBtn.textContent = headerThemeToggleCompact.textContent;
        if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.micro) {
          HapticFeedbackService.micro();
        }
      });
      updateCompactIcon();
    }

    var rulesInfoBtnCompact = document.getElementById('header-rules-info-btn-compact');
    if (rulesInfoBtnCompact && !rulesInfoBtnCompact._rulesInfoCompactBound) {
      rulesInfoBtnCompact._rulesInfoCompactBound = true;
      rulesInfoBtnCompact.addEventListener('click', function () {
        var modal = document.getElementById('rules-info-modal');
        if (modal) {
          modal.classList.add('active');
          document.body.classList.add('modal-open');
        }
        if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.micro) {
          HapticFeedbackService.micro();
        }
      });
    }

    // ── V3.1.2: Scroll listener — fade compact header in over a range as the hero scrolls away ──
    var compactHeader = document.getElementById('app-header-compact');
    if (compactHeader && !compactHeader._scrollBound) {
      compactHeader._scrollBound = true;
      var FADE_START = 80;   // start fading in
      var FADE_END = 220;    // fully visible
      var lastScrollY = -1;
      var compactScrollRaf = null;

      var updateCompactVisibility = function () {
        compactScrollRaf = null;
        var y = window.pageYOffset || document.documentElement.scrollTop || 0;
        if (y === lastScrollY) return;
        lastScrollY = y;

        if (y <= FADE_START) {
          compactHeader.classList.remove('is-visible');
          compactHeader.style.opacity = '';
          compactHeader.style.transform = '';
          compactHeader.style.pointerEvents = '';
          compactHeader.setAttribute('aria-hidden', 'true');
        } else if (y >= FADE_END) {
          compactHeader.classList.add('is-visible');
          compactHeader.style.opacity = '';
          compactHeader.style.transform = '';
          compactHeader.style.pointerEvents = '';
          compactHeader.setAttribute('aria-hidden', 'false');
        } else {
          // In between — interpolate opacity manually for smooth scroll-tied fade
          var t = (y - FADE_START) / (FADE_END - FADE_START);
          compactHeader.classList.remove('is-visible');
          compactHeader.style.opacity = String(t);
          compactHeader.style.transform = 'translateY(' + ((1 - t) * -4) + 'px)';
          compactHeader.style.pointerEvents = t > 0.5 ? 'auto' : 'none';
          compactHeader.setAttribute('aria-hidden', t > 0.5 ? 'false' : 'true');
        }
      };

      window.addEventListener('scroll', function () {
        if (compactScrollRaf) return;
        compactScrollRaf = requestAnimationFrame(updateCompactVisibility);
      }, { passive: true });

      // Initial state
      updateCompactVisibility();
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

    // ── V3.1 Gradient Theme Picker ──
    var GRADIENT_CLASSES = ['gradient-warmth', 'gradient-emerald', 'gradient-sunset', 'gradient-ocean', 'gradient-lavender', 'gradient-monochrome'];

    function _applyHeaderGradientClass(gradient) {
      var header = document.querySelector('.app-header');
      var compact = document.getElementById('app-header-compact');
      for (var gi = 0; gi < GRADIENT_CLASSES.length; gi++) {
        if (header) header.classList.remove(GRADIENT_CLASSES[gi]);
        if (compact) compact.classList.remove(GRADIENT_CLASSES[gi]);
      }
      if (gradient && gradient !== 'default') {
        var cls = 'gradient-' + gradient;
        if (header) header.classList.add(cls);
        if (compact) compact.classList.add(cls);
      }
    }

    // Load saved gradient on startup
    var savedGradient = AppState.get('headerGradientTheme') || 'warmth';
    _applyHeaderGradientClass(savedGradient);

    // Bind gradient picker buttons
    var gradientContainer = document.getElementById('gradient-theme-options');
    if (gradientContainer) {
      // Mark saved gradient as active
      var gradientBtns = gradientContainer.querySelectorAll('.gradient-option');
      for (var gbi = 0; gbi < gradientBtns.length; gbi++) {
        if (gradientBtns[gbi].getAttribute('data-gradient') === savedGradient) {
          gradientBtns[gbi].classList.add('active');
        } else {
          gradientBtns[gbi].classList.remove('active');
        }
      }

      gradientContainer.addEventListener('click', function(e) {
        var btn = e.target.closest('.gradient-option');
        if (!btn) return;
        var gradient = btn.getAttribute('data-gradient');
        if (!gradient) return;

        // Apply gradient class
        _applyHeaderGradientClass(gradient);

        // Update active state
        var allGBtns = gradientContainer.querySelectorAll('.gradient-option');
        for (var i = 0; i < allGBtns.length; i++) {
          allGBtns[i].classList.remove('active');
        }
        btn.classList.add('active');

        // Persist
        AppState.set('headerGradientTheme', gradient);

        // Haptic feedback
        if (typeof HapticFeedbackService !== 'undefined' && HapticFeedbackService.micro) {
          HapticFeedbackService.micro();
        }
      });
    }

    // ── Familienversicherung Info Toggle (Onboarding) ──
    var kvRadios = document.querySelectorAll('input[name="onb-krankenversicherung"]');
    var fvInfo = document.getElementById('onb-familienversicherung-info');
    if (kvRadios.length > 0 && fvInfo) {
      for (var kvi = 0; kvi < kvRadios.length; kvi++) {
        kvRadios[kvi].addEventListener('change', function () {
          var selected = document.querySelector('input[name="onb-krankenversicherung"]:checked');
          fvInfo.style.display = (selected && selected.value === 'familienversicherung') ? '' : 'none';
        });
      }
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

    // ── Phase 8: Version Check & Changelog ──
    _checkForVersionUpdate();
    _renderSettingsChangelog();

    // Bind update banner close button
    var updateBannerClose = document.getElementById('update-banner-close');
    if (updateBannerClose) {
      updateBannerClose.addEventListener('click', function () {
        var banner = document.getElementById('update-banner');
        if (banner) banner.style.display = 'none';
        // Save version so banner doesn't show again
        AppState.set('lastSeenVersion', APP_VERSION);
      });
    }

    // ── Phase 9: Service Worker Registration ──
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
    ICSImportModule: ICSImportModule,
    PersonalDataModule: PersonalDataModule,
    YearChangePrompt: YearChangePrompt,
    HapticFeedbackService: HapticFeedbackService,
    SkeletonLoader: SkeletonLoader,
    SwipeHandler: SwipeHandler,
    PullRefreshHandler: PullRefreshHandler,
    SparklineRenderer: SparklineRenderer,
    PunchClock: PunchClock,
    RuleChecker: RuleChecker,
    MinijobForecastWidget: MinijobForecastWidget,
    GeoReminderService: GeoReminderService,
    DashboardOrderManager: DashboardOrderManager,
    NotificationScheduler: NotificationScheduler,
    showToast: showToast
  };
})();
