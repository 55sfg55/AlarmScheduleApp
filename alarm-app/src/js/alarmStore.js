// alarmStore.js – alarm data, persistence, and state management

const STORAGE_KEY = 'alarmAppData';

export let alarms = [];
export let selectedAlarmId = null;
export let currentPlatform = 'desktop';   // 'desktop' | 'android'
export let timeFormat24h = true;

// ── Setters (required because imports are read‑only) ──
export function setSelectedAlarmId(id) { selectedAlarmId = id; }
export function setCurrentPlatform(platform) { currentPlatform = platform; }
export function setTimeFormat24h(value) { timeFormat24h = value; }

// ── Data loading / saving ──
function createDefaults() {
  return [
    {
      id: 'a1', label: 'Morning', time: '07:00', triggerType: 'specific',
      afterEventSource: '', afterEventDelay: 5,
      screens: {
        desktop: { primary: 'simple-dismiss', secondary: '', between: '' },
        android:  { primary: 'swipe-dismiss', secondary: '', between: '' }
      },
      soundFileName: 'chime.mp3', soundPath: null, disableAfterAction: true,
      logMessage: 'Morning alarm dismissed', showBetweenScreen: false, enabled: true
    },
    {
      id: 'a2', label: 'Reminder', time: '08:30', triggerType: 'specific',
      afterEventSource: '', afterEventDelay: 3,
      screens: {
        desktop: { primary: 'hold-dismiss', secondary: 'simple-dismiss', between: '' },
        android:  { primary: 'hold-dismiss', secondary: 'swipe-dismiss', between: '' }
      },
      soundFileName: 'alert.wav', soundPath: null, disableAfterAction: false,
      logMessage: 'Reminder done', showBetweenScreen: false, enabled: true
    },
    {
      id: 'a3', label: 'Chained after Morning', time: '', triggerType: 'after-event',
      afterEventSource: 'a1', afterEventDelay: 2,
      screens: {
        desktop: { primary: 'pattern-dismiss', secondary: '', between: 'between-message' },
        android:  { primary: 'simple-dismiss', secondary: '', between: 'between-message' }
      },
      soundFileName: 'reminder.mp3', soundPath: null, disableAfterAction: true,
      logMessage: 'Chained alarm fired', showBetweenScreen: true, enabled: true
    },
    {
      id: 'b1',
      label: 'Silent Night',
      triggerType: 'blocking',
      blockStartTime: '23:00',
      blockEndTime: '07:00',
      enabled: true,
    }
  ];
}

function migrate(alarm) {
  if (!alarm.screens) {
    alarm.screens = {
      desktop: { primary: alarm.screenDesktop || 'simple-dismiss', secondary: '', between: '' },
      android:  { primary: alarm.screenAndroid || 'swipe-dismiss', secondary: '', between: '' }
    };
  }
  if (alarm.showBetweenScreen === undefined) alarm.showBetweenScreen = false;
  if (!alarm.logMessage) alarm.logMessage = '';
  // Migrate old sound storage: drop any inlined data URLs to avoid localStorage quota issues
  if (alarm.soundDataUrl) {
    delete alarm.soundDataUrl;
  }
  if (alarm.soundUrl) {
    console.debug('[migrate] Dropping soundUrl from alarm', alarm.id);
    delete alarm.soundUrl;
  }
  if (alarm.soundPath === undefined) alarm.soundPath = null;
  if (alarm.triggerType === 'blocking') {
    alarm.blockStartTime = alarm.blockStartTime || '23:00';
    alarm.blockEndTime = alarm.blockEndTime || '07:00';
  } else {
    // For other types, clear these fields to avoid confusion
    alarm.blockStartTime = '';
    alarm.blockEndTime = '';
  }
  return alarm;
}

export function loadAlarms() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { alarms = JSON.parse(saved).map(migrate); } catch (e) { alarms = createDefaults(); }
  } else {
    alarms = createDefaults();
  }
  console.debug('[loadAlarms] Loaded', alarms.length, 'alarms');
  if (alarms.length > 0) {
    console.debug('[loadAlarms] First alarm:', { id: alarms[0].id, soundPath: alarms[0].soundPath, soundFileName: alarms[0].soundFileName, soundUrl: alarms[0].soundUrl ? 'SET' : 'null' });
  }
  saveAlarms();
}

export function saveAlarms() {
  // NEVER persist soundUrl to localStorage; only save the persistent app-data path.
  const toSave = alarms.map(a => {
    const copy = { ...a };
    if (copy.soundUrl) {
      console.debug('[saveAlarms] Removing soundUrl from', a.id, 'before save');
      delete copy.soundUrl;
    }
    return copy;
  });
  console.debug('[saveAlarms] Saving', toSave.length, 'alarms, first soundPath:', toSave[0]?.soundPath, 'soundFileName:', toSave[0]?.soundFileName);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

export function getAlarmById(id) {
  const alarm = alarms.find(a => a.id === id);
  if (alarm) {
    console.debug('[getAlarmById]', id, '| soundPath:', alarm.soundPath, '| soundFileName:', alarm.soundFileName, '| soundUrl:', alarm.soundUrl ? 'SET (blob)' : 'null');
  } else {
    console.warn('[getAlarmById] Alarm not found:', id);
  }
  return alarm;
}

export function getCurrentScreenId(alarm, slot = 'primary') {
  const screens = alarm.screens?.[currentPlatform] || {};
  return screens[slot] || (slot === 'primary' ? 'simple-dismiss' : '');
}