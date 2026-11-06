// Voice input via the browser's Web Speech API.
//
// PRIVACY: speech recognition is performed by the browser vendor's service
// (e.g. Chrome sends audio to Google). This app never receives or stores audio,
// only the resulting text. The UI says so next to the microphone button.

const BCP47 = { en: 'en-NG', fr: 'fr-FR', ha: 'ha-NG', yo: 'yo-NG', ig: 'ig-NG', sw: 'sw-KE', ar: 'ar-SA', pt: 'pt-PT' };

export function voiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * @param {{getLang: () => string, onText: (s: string) => void, onState: (s: 'idle'|'listening') => void, onError: (kind: 'denied'|'failed') => void}} h
 */
export function createVoice({ getLang, onText, onState, onError }) {
  const Ctor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  let rec = null;

  function start(overrideLang = null) {
    if (!Ctor) return;
    stop();
    const lang = overrideLang ?? BCP47[getLang()] ?? 'en-NG';
    rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let gotResult = false;
    let retried = false;
    rec.onstart = () => onState('listening');
    rec.onresult = (e) => {
      gotResult = true;
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) onText(text);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onError('denied');
      else if (e.error === 'language-not-supported' && lang !== 'en-NG' && !retried) { retried = true; start('en-NG'); return; }
      else if (e.error !== 'aborted') onError('failed');
    };
    rec.onend = () => { if (!gotResult && !retried) { /* nothing heard */ } onState('idle'); };
    try { rec.start(); } catch { onError('failed'); onState('idle'); }
  }

  function stop() { try { rec?.stop(); } catch { /* already stopped */ } rec = null; }
  return { start, stop, supported: !!Ctor };
}
