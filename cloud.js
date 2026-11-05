// Cloud sync with Firebase: Google sign-in + one private Firestore document per user.
// The app keeps working offline from the browser copy; this file mirrors it to the cloud.
import * as cfg from './firebase-config.js?v=28';
const { firebaseConfig } = cfg;

// newer SDK first (needed for the receipt scanner); the old one is a safety net for sign-in + sync
const SDKS = ['https://www.gstatic.com/firebasejs/12.19.0/', 'https://www.gstatic.com/firebasejs/10.12.2/'];
let SDK = SDKS[0];
const DEVICE_KEY = 'budget-debt-tracker:v1:device';

const cloud = {
  enabled: false,
  user: null,
  status: 'off', // off | syncing | synced | error
  lastSync: 0,
  statusText() {
    if (this.status === 'syncing') return 'Saving to the cloud…';
    if (this.status === 'error') return 'Could not reach the cloud. Changes are saved on this device and will sync when you are back online.';
    if (this.status === 'synced') return `Synced${this.lastSync ? ' · ' + new Date(this.lastSync).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''}`;
    return 'Connecting…';
  },
  scanReady: false,
  push() {}, signIn() {}, signOut() {}, readReceipt: null,
};
window.cloud = cloud;

const T = () => window.tracker;
const rerender = () => { if (T()) T().render(); };

function deviceId() {
  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { /* ignore */ }
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ }
  }
  return id;
}

async function start() {
  if (!firebaseConfig || !firebaseConfig.apiKey) return; // cloud sync not set up
  cloud.pending = true; // show a short loading screen instead of flashing the sign-in page
  rerender();
  const giveUp = setTimeout(() => { if (cloud.pending) { cloud.pending = false; rerender(); } }, 8000);
  let appMod, authMod, fsMod;
  for (const base of SDKS) {
    try {
      [appMod, authMod, fsMod] = await Promise.all([
        import(base + 'firebase-app.js'),
        import(base + 'firebase-auth.js'),
        import(base + 'firebase-firestore.js'),
      ]);
      SDK = base;
      break;
    } catch (e) { console.warn('Firebase could not load from ' + base, e); }
  }
  if (!appMod) {
    console.warn('Firebase could not load; cloud sync is off for now.');
    clearTimeout(giveUp); cloud.pending = false; rerender();
    return;
  }
  const { initializeApp } = appMod;
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } = authMod;
  const { getFirestore, doc, getDoc, setDoc, onSnapshot } = fsMod;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const me = deviceId();
  let ref = null, unsub = null, timer = null, lastJson = '';

  cloud.enabled = true;
  rerender();

  // ---------- Scan receipt: Gemini through Firebase AI Logic ----------
  const recaptchaKey = cfg.recaptchaKey || '';
  const models = (cfg.aiModels && cfg.aiModels.length) ? cfg.aiModels : ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  let appCheckP = null, aiP = null, modelIx = 0, acMod = null, acInst = null;
  if (recaptchaKey && SDK === SDKS[0]) {
    cloud.scanReady = true;
    // start App Check early so reCAPTCHA has a score ready by the time you scan
    appCheckP = import(SDK + 'firebase-app-check.js').then((ac) => {
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      acMod = ac;
      acInst = ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(recaptchaKey), isTokenAutoRefreshEnabled: true });
      return acInst;
    }).catch((e) => { console.warn('App Check could not start', e); });
    rerender();
  }
  const getAi = () => (aiP || (aiP = (async () => {
    await appCheckP;
    const m = await import(SDK + 'firebase-ai.js');
    return { m, ai: m.getAI(app, { backend: new m.GoogleAIBackend() }) };
  })()));

  // turn Firebase/Gemini errors into plain words, and keep the real reason at the end for troubleshooting
  function friendly(e) {
    const t = String((e && (e.message || e.code)) || e);
    const why = '<br><br><span class="muted small">Details: ' + t.replace(/[<>&]/g, ' ').slice(0, 300) + '</span>';
    let msg;
    if (/has not been used|SERVICE_DISABLED|is disabled|not.{0,20}enabled/i.test(t)) msg = 'AI Logic is not fully turned on yet in your Firebase project (it can take a few minutes after you enable it).';
    else if (/app.?check|attestation|recaptcha/i.test(t)) msg = 'App Check blocked the scan. Check the reCAPTCHA key and that this site\'s domain is on it.';
    else if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(t)) msg = 'Gemini\'s free limit was reached (per minute or per day). Wait a minute and try again, or add it manually.';
    else if (/\b40[13]\b|PERMISSION_DENIED|unauthenticated|API key/i.test(t)) msg = 'Google refused the request (permission). The setup may not be finished.';
    else if (/\b(500|502|503|504)\b|high demand|overloaded|UNAVAILABLE/i.test(t)) msg = 'Gemini is busy right now (Google\'s side). Wait a minute and try again, or add it manually.';
    else if (/Load failed|Failed to fetch|NetworkError|network|offline/i.test(t)) msg = 'The connection to Gemini dropped. Check your signal or Wi-Fi and try again.';
    else msg = 'Gemini could not read the receipt.';
    return msg + why;
  }

  cloud.readReceipt = async ({ data, mimeType }, categories) => {
    if (!recaptchaKey) throw new Error('The scanner is not set up yet (add the reCAPTCHA key in firebase-config.js).');
    const { m, ai } = await getAi().catch((e) => { aiP = null; throw new Error(friendly(e)); });
    // check App Check first, so a setup problem gets a clear message instead of a generic 401
    if (acMod && acInst) {
      try { await acMod.getToken(acInst, false); } catch (e) {
        console.error('App Check', e);
        const t = String((e && (e.message || e.code)) || e);
        let hint = 'App Check could not get a token for this site.';
        if (/recaptcha/i.test(t)) hint = 'reCAPTCHA did not accept this site. Check that the key\'s domain list has jcqtqt.github.io and that it is a "Web" key in project-1-7b491.';
        if (/\b(400|403|404)\b|exchange|not.?registered|fetch-status-error/i.test(t)) hint = 'Firebase App Check did not accept the reCAPTCHA token. In Firebase → Security → App Check → Apps, register your web app with reCAPTCHA Enterprise and this exact key, then wait a few minutes.';
        throw new Error(hint + '<br><br><span class="muted small">Details: ' + t.replace(/[<>&]/g, ' ').slice(0, 300) + '</span>');
      }
    }
    const year = new Date().getFullYear();
    const prompt = `You read shop receipts for a Philippine budget app. Look at the image and reply with JSON only, no other text:
{"isReceipt": true or false, "store": "shop name", "date": "YYYY-MM-DD or empty", "total": number, "category": "one of the list", "items": [{"name": "short item name", "amount": number}], "notes": "anything unclear, or empty"}
Rules: "total" is the final amount paid (grand total, after discounts, VAT included). Numbers have no currency signs or commas. If the year is missing use ${year}. Use at most 15 items; skip VAT, subtotal, change and tender lines. "category" must be exactly one of: ${JSON.stringify(categories)}. If the image is not a receipt or bill, set isReceipt to false.`;
    let lastErr, retried = false;
    const NET = /Load failed|Failed to fetch|NetworkError|network|ECONNRESET|timed? ?out|aborted/i;
    for (let i = modelIx; i < models.length; i++) {
      try {
        const model = m.getGenerativeModel(ai, { model: models[i], generationConfig: { responseMimeType: 'application/json' } });
        const res = await model.generateContent([prompt, { inlineData: { data, mimeType } }]);
        const txt = res.response.text().replace(/^\s*```(?:json)?|```\s*$/g, '').trim();
        return JSON.parse(txt);
      } catch (e) {
        lastErr = e;
        const t = String((e && e.message) || e);
        if (NET.test(t) && !retried) { retried = true; await new Promise((r) => setTimeout(r, 1500)); i--; continue; }
        if (NET.test(t) && i < models.length - 1) { console.warn(models[i] + ' connection dropped, trying ' + models[i + 1], e); continue; }
        // model not offered on this plan / retired: try the next one
        // model not offered on the free plan / retired / no free quota: try the next one
        if (/\b(404|429|500|502|503|504)\b|not.?found|not supported|unsupported model|is not available|RESOURCE_EXHAUSTED|quota|high demand|overloaded|UNAVAILABLE|try again later/i.test(t) && i < models.length - 1) { console.warn(models[i] + ' failed, trying ' + models[i + 1], e); continue; }
        console.error(e);
        throw new Error(e instanceof SyntaxError ? 'Gemini replied in an unexpected way. Try a clearer photo.' : friendly(e));
      }
    }
    throw new Error(friendly(lastErr));
  };

  const setStatus = (s) => { cloud.status = s; if (s === 'synced') cloud.lastSync = Date.now(); rerender(); };

  async function upload(json) {
    if (!ref) return;
    setStatus('syncing');
    try {
      await setDoc(ref, { data: json, updatedAt: Date.now(), device: me, v: 1 });
      lastJson = json;
      setStatus('synced');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  }

  cloud.push = (state) => {
    if (!ref) return;
    const json = JSON.stringify(state);
    if (json === lastJson) return;
    clearTimeout(timer);
    timer = setTimeout(() => upload(json), 700);
  };

  cloud.signIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        await signInWithRedirect(auth, provider);
      } else if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        console.error(e);
        T().toast('Sign-in failed: ' + (e.code || e.message), 6000);
      }
    }
  };

  async function finishSignOut() {
    clearTimeout(timer);
    if (unsub) { unsub(); unsub = null; }
    ref = null; lastJson = '';
    await signOut(auth);
    T().clearLocal();
    T().toast('Signed out. Your data is safe in your cloud account.');
  }

  cloud.signOut = async () => {
    // make sure the latest changes reach the cloud before clearing this browser
    clearTimeout(timer);
    const json = JSON.stringify(T().state);
    if (ref && json !== lastJson) {
      try {
        await setDoc(ref, { data: json, updatedAt: Date.now(), device: me, v: 1 });
        lastJson = json;
      } catch (e) {
        console.error(e);
        T().choose('Not saved to the cloud yet',
          'Your latest changes could not be uploaded (are you offline?). If you sign out now, those changes will be lost.',
          [
            { label: 'Stay signed in', primary: true, fn: () => {} },
            { label: 'Sign out anyway', fn: () => { finishSignOut(); } },
          ]);
        return;
      }
    }
    await finishSignOut();
  };

  getRedirectResult(auth).catch((e) => console.warn(e));

  async function connect(user) {
    ref = doc(db, 'trackers', user.uid);
    setStatus('syncing');
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (e) {
      console.error(e);
      setStatus('error');
      T().toast('Could not read your cloud data: ' + (e.code || e.message), 6000);
      return;
    }
    const localJson = JSON.stringify(T().state);
    const localHas = T().hasData();

    if (!snap.exists() || !snap.data().data) {
      // first sign-in: upload what this browser has
      if (localHas) { await upload(localJson); T().toast('Your data is now saved to the cloud'); } else setStatus('synced');
    } else {
      const cloudJson = snap.data().data;
      lastJson = cloudJson;
      if (cloudJson === localJson) setStatus('synced');
      else if (!localHas) { T().replace(JSON.parse(cloudJson), { fromCloud: true }); setStatus('synced'); T().toast('Loaded your data from the cloud'); }
      else {
        await new Promise((done) => {
          T().choose('Which data should we keep?',
            `Your cloud copy (last saved ${new Date(snap.data().updatedAt || 0).toLocaleString('en-PH')}) is different from what's in this browser.`,
            [
              { label: 'Use my cloud data (recommended)', primary: true, fn: () => { T().replace(JSON.parse(cloudJson), { fromCloud: true }); setStatus('synced'); done(); } },
              { label: 'Replace cloud with this browser', fn: () => { upload(localJson).then(done); } },
            ]);
        });
      }
    }

    if (T().runAuto) T().runAuto(); // end-of-month interest, now that the cloud copy is in

    // live updates from your other devices
    unsub = onSnapshot(ref, (s) => {
      if (s.metadata.hasPendingWrites || !s.exists()) return;
      const d = s.data();
      if (!d || !d.data || d.data === lastJson) return;
      if (d.device === me) { lastJson = d.data; return; }
      lastJson = d.data;
      if (d.data !== JSON.stringify(T().state)) {
        T().replace(JSON.parse(d.data), { fromCloud: true });
        T().toast('Updated from your other device');
      }
      setStatus('synced');
    }, (e) => { console.error(e); setStatus('error'); });
  }

  onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    ref = null; lastJson = '';
    cloud.user = user ? { displayName: user.displayName, email: user.email, photoURL: user.photoURL, uid: user.uid } : null;
    cloud.status = 'off';
    cloud.ready = true; cloud.pending = false; clearTimeout(giveUp);
    if (user && T().signedIn) T().signedIn();
    rerender();
    if (user) connect(user);
  });

  window.addEventListener('online', () => { if (ref && cloud.status === 'error') cloud.push(T().state); });
}

start();
