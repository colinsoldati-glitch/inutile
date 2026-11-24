import {
  FIREBASE_VAPID_KEY, PUSH_WORKER_URL, KEYS,
  db, ref, set, update, remove, onValue, get,
  getMessaging, getToken, onMessage, isSupported,
  state, $, saveSession, haptic, genId, esc,
  showToast, handleFirebaseError, formatShortDateFr,
  extractEnsembleCode, getInviteUrl, copyTextReliable, shareOrCopy
} from "./config.js";
import { openConfirmationModal, openModal, closeModal } from "./ui.js";

let hooks = {
  archiveFailedPollsIfNeeded: async () => {},
  renderPolls: () => {},
  renderAgenda: () => {},
  openAdminPinPrompt: () => {},
  maybeDisplayLatestAnnouncement: () => {}
};

export function registerEnsembleHooks(h) {
  hooks = { ...hooks, ...h };
}

// Service Worker & Notifications Push
export async function initServiceWorkerAndPush() {
  if (!("serviceWorker" in navigator)) return;
  try {
    state.swRegistration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    if (await isSupported().catch(() => false)) {
      state.messagingInstance = getMessaging();
      onMessage(state.messagingInstance, (p) => {
        if (isEnsemblePushActive()) triggerLocalSystemNotification(p.notification?.title || p.data?.title || "Cadenza", p.notification?.body || p.data?.body || "Mise à jour.");
      });
    }
  } catch (e) { console.warn("SW init:", e); }
  updatePushUI();
}

export function isEnsemblePushActive() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !state.session.activeEnsembleId) return false;
  const myId = state.session.ensembles[state.session.activeEnsembleId]?.memberId;
  return Boolean(myId && state.currentEnsembleData?.members?.[myId]?.pushEnabled === true);
}

export async function triggerLocalSystemNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, tag: "cadenza-update", renotify: true, data: { url: window.location.href } };
  if (state.swRegistration?.showNotification) await state.swRegistration.showNotification(title, opts);
  else new Notification(title, opts);
}

export async function fetchFcmTokenSafe() {
  if (!state.messagingInstance || !state.swRegistration) return null;
  try { await navigator.serviceWorker.ready; return await getToken(state.messagingInstance, { vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: state.swRegistration }); }
  catch (_) { return null; }
}

export async function togglePushForEnsemble() {
  haptic();
  const ensId = state.session.activeEnsembleId, mbrId = state.session.ensembles[ensId]?.memberId;
  const ensName = state.currentEnsembleData?.name || "cet ensemble";

  if (isEnsemblePushActive()) {
    if (!ensId || !mbrId) return;
    try {
      await update(ref(db, `ensembles/${ensId}/members/${mbrId}`), { pushEnabled: false, fcmToken: null });
      updatePushUI(); showToast(`Notifications désactivées pour ${ensName}.`);
    } catch (err) { handleFirebaseError(err); }
    return;
  }

  if (!("Notification" in window)) return showToast("Notifications non supportées sur ce navigateur.");
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isIOS && !isStandalone) return showToast("Sur iPhone/iPad : Partager > Sur l'écran d'accueil d'abord.");

  if ((await Notification.requestPermission()) !== "granted") {
    updatePushUI(); return showToast("Autorisation refusée dans les réglages du navigateur.");
  }

  const fcmToken = await fetchFcmTokenSafe();
  if (ensId && mbrId) {
    try {
      await update(ref(db, `ensembles/${ensId}/members/${mbrId}`), { pushEnabled: true, ...(fcmToken ? { fcmToken } : {}) });
    } catch (err) { return handleFirebaseError(err); }
  }
  updatePushUI();
  showToast(`Notifications activées pour ${ensName}.`);
  await triggerLocalSystemNotification(`Cadenza — ${ensName}`, "Les alertes de l'ensemble sont activées.");
}

export function updatePushUI() {
  const dot = $("notif-status-dot"), msg = $("push-status-msg"), toggle = $("btn-toggle-push"), test = $("btn-test-push");
  if (!("Notification" in window)) {
    dot.classList.add("off"); msg.textContent = "Navigateur non compatible."; toggle.disabled = true; return;
  }
  const active = isEnsemblePushActive(), ensName = state.currentEnsembleData?.name || "cet ensemble";
  dot.classList.toggle("off", !active);
  toggle.textContent = active ? "Désactiver pour cet ensemble" : "Activer les notifications";
  toggle.className = `${active ? "btn-del-subtle" : "btn-primary"} btn-sm`;
  test.classList.toggle("hidden", !active);
  msg.textContent = active
    ? `Statut : Actives pour « ${ensName} ».`
    : Notification.permission === "denied"
      ? "Statut : Bloquées dans les réglages de votre navigateur."
      : `Statut : Désactivées pour « ${ensName} ».`;
}

export async function triggerNativeInstall() {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt(); await state.deferredInstallPrompt.userChoice; state.deferredInstallPrompt = null;
  $("install-banner").classList.add("hidden"); $("tuto-direct-install-card").classList.add("hidden");
}

// Navigation entre vues
export function switchTab(tab) {
  haptic();
  ["agenda", "avail", "ensemble"].forEach((t) => $(`view-${t}`).classList.toggle("hidden", t !== tab));
  document.querySelectorAll(".tab-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
}

// Tutoriel & Onboarding
export function showInstallTutorial() {
  ["app-header", "app-nav", "view-agenda", "view-avail", "view-ensemble", "view-onboarding", "install-banner"].forEach((id) => $(id).classList.add("hidden"));
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  $("tuto-ios-card").classList.toggle("featured", isIOS);
  $("tuto-android-card").classList.toggle("featured", !isIOS);
  $("view-install-tuto").classList.remove("hidden");
}

export function renderClaimableMembers(ensId, data) {
  const box = $("join-existing-members-box"), list = $("join-existing-members-list"), kicker = $("join-new-member-kicker");
  const members = data?.members ? Object.values(data.members) : [];
  if (!data || !members.length) { box.classList.add("hidden"); list.innerHTML = ""; kicker.classList.add("hidden"); return; }
  kicker.classList.remove("hidden"); box.classList.remove("hidden");
  list.innerHTML = members.map((m) => `<button type="button" class="btn-secondary btn-sm btn-full" style="justify-content:space-between" data-claim="${esc(m.id)}"><span><strong>${esc(m.name)}</strong> • ${esc(m.instrument)}</span><span style="font-size:12px;color:var(--muted)">Reprendre →</span></button>`).join("");
  list.onclick = async (e) => {
    const b = e.target.closest("[data-claim]");
    if (!b) return;
    haptic();
    const m = data.members[b.dataset.claim];
    if (!m) return;
    state.session.ensembles[ensId] = { memberId: m.id, name: m.name, instrument: m.instrument, ensembleName: data.name };
    state.session.activeEnsembleId = ensId; saveSession();
    if (m.pushEnabled && Notification.permission === "granted") {
      const tok = await fetchFcmTokenSafe();
      if (tok) update(ref(db, `ensembles/${ensId}/members/${m.id}`), { fcmToken: tok }).catch(() => {});
    }
    window.history.replaceState({}, "", window.location.pathname);
    showToast(`Profil de ${m.name} restauré.`); enterEnsemble(ensId);
  };
}

export async function proceedAfterTutorial() {
  const params = new URLSearchParams(window.location.search);
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(KEYS.invite) || "null"); } catch (_) {}
  const ensId = params.get("ensemble") || pending?.ensembleId || null;
  const mbrId = params.get("member") || pending?.memberId || null;

  if (ensId) {
    localStorage.removeItem(KEYS.invite);
    if (mbrId) {
      try {
        const snap = await get(ref(db, `ensembles/${ensId}`));
        const d = snap.exists() ? snap.val() : null;
        const target = d?.members?.[mbrId];
        if (target) {
          state.session.ensembles[ensId] = { memberId: target.id, name: target.name, instrument: target.instrument, ensembleName: d.name };
          state.session.activeEnsembleId = ensId; saveSession();
          window.history.replaceState({}, "", window.location.pathname);
          showToast(`Profil de ${target.name} restauré.`);
          return enterEnsemble(ensId);
        }
      } catch (err) { handleFirebaseError(err); }
    }
    if (state.session.ensembles[ensId]) {
      state.session.activeEnsembleId = ensId; saveSession();
      window.history.replaceState({}, "", window.location.pathname);
      return enterEnsemble(ensId);
    }
    $("join-code").value = ensId; $("join-card").classList.add("featured");
    try {
      const snap = await get(ref(db, `ensembles/${ensId}`));
      if (snap.exists()) {
        const d = snap.val();
        $("join-kicker").textContent = `Invitation — ${d.formation || "Ensemble"}`;
        $("join-ensemble-title").textContent = `Rejoindre « ${d.name} »`;
        ["join-code-field", "create-card", "onboarding-divider"].forEach((id) => $(id).classList.add("hidden"));
        renderClaimableMembers(ensId, d);
      } else showToast("Cet ensemble est introuvable.");
    } catch (err) { handleFirebaseError(err); }
    return showOnboarding();
  }
  state.session.activeEnsembleId && state.session.ensembles[state.session.activeEnsembleId] ? enterEnsemble(state.session.activeEnsembleId) : showOnboarding();
}

export function showOnboarding() {
  ["view-install-tuto", "app-header", "app-nav", "view-agenda", "view-avail", "view-ensemble"].forEach((id) => $(id).classList.add("hidden"));
  $("view-onboarding").classList.remove("hidden");
}

export function enterEnsemble(ensembleId) {
  ["view-install-tuto", "view-onboarding"].forEach((id) => $(id).classList.add("hidden"));
  ["app-header", "app-nav"].forEach((id) => $(id).classList.remove("hidden"));
  $("header-ensemble-name").textContent = state.session.ensembles[ensembleId]?.ensembleName || ensembleId;
  switchTab("agenda");

  if (state.unsubscribeEnsemble) state.unsubscribeEnsemble();
  state.unsubscribeEnsemble = onValue(ref(db, `ensembles/${ensembleId}`), (snap) => {
    $("firebase-error-banner").classList.add("hidden");
    if (!snap.exists()) {
      showToast("Cet ensemble n'existe plus.");
      delete state.session.ensembles[ensembleId]; state.session.activeEnsembleId = null; saveSession();
      return showOnboarding();
    }
    state.currentEnsembleData = snap.val();
    const mySes = state.session.ensembles[ensembleId];
    if (mySes) {
      mySes.ensembleName = state.currentEnsembleData.name;
      const m = state.currentEnsembleData.members?.[mySes.memberId];
      if (m) { mySes.name = m.name; mySes.instrument = m.instrument; }
      saveSession();
    }

    const myId = mySes?.memberId, evt = state.currentEnsembleData.lastEvent;
    const targeted = !Array.isArray(evt?.targetMemberIds) || evt.targetMemberIds.includes(myId);
    if (state.currentEnsembleData.members?.[myId]?.pushEnabled && evt && evt.timestamp > state.lastNotifiedTimestamp && evt.authorId !== myId && targeted) {
      state.lastNotifiedTimestamp = evt.timestamp; localStorage.setItem(KEYS.evtTs, String(state.lastNotifiedTimestamp));
      triggerLocalSystemNotification(evt.title, evt.body);
    }
    hooks.archiveFailedPollsIfNeeded();
    renderAll();
  }, handleFirebaseError);
}

export async function publishEnsembleNotification(title, body, options = {}) {
  if (!state.session.activeEnsembleId) return;
  const authorId = state.session.ensembles[state.session.activeEnsembleId]?.memberId, ts = Date.now();
  state.lastNotifiedTimestamp = ts; localStorage.setItem(KEYS.evtTs, String(ts));
  const targetMemberIds = Array.isArray(options.targetMemberIds) ? options.targetMemberIds : null;
  try {
    await update(ref(db, `ensembles/${state.session.activeEnsembleId}`), {
      lastEvent: { title, body, timestamp: ts, authorId, ...(targetMemberIds ? { targetMemberIds } : {}) }
    });
    if (PUSH_WORKER_URL) {
      fetch(PUSH_WORKER_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ensembleId: state.session.activeEnsembleId, title, body, authorId, ...(targetMemberIds ? { targetMemberIds } : {}), url: getInviteUrl(state.session.activeEnsembleId) })
      }).catch(() => {});
    }
  } catch (err) { handleFirebaseError(err); }
}

export function renderAll() {
  if (!state.currentEnsembleData) return;
  $("header-ensemble-name").textContent = `${state.currentEnsembleData.name} • ${state.currentEnsembleData.formation || ""}`;
  updatePushUI();
  hooks.renderAgenda();
  hooks.renderPolls();
  renderEnsembleInfo();
}

export function renderEnsembleInfo() {
  const membersObj = state.currentEnsembleData.members || {}, members = Object.values(membersObj);
  const myId = state.session.ensembles[state.session.activeEnsembleId]?.memberId, today = new Date().toISOString().split("T")[0];

  $("info-formation").textContent = state.currentEnsembleData.formation || "Ensemble";
  $("info-name").textContent = state.currentEnsembleData.name;
  $("info-code").textContent = state.session.activeEnsembleId;
  $("members-count").textContent = members.length;
  $("toggle-auto-remind-eve").checked = state.currentEnsembleData.autoRemindEve !== false;

  $("members-list").innerHTML = members.map((m) => {
    const isMe = m.id === myId, abs = Object.values(m.unavailabilities || {}).filter((u) => u.endDate >= today).length;
    return `<div class="member-row">
      <div style="min-width:0"><div><strong>${esc(m.name)}</strong> ${isMe ? "(Vous)" : ""}</div><div style="font-size:12.5px;color:var(--muted)">${esc(m.instrument)} • ${m.pushEnabled ? "Alertes actives" : "Sans alerte"}${abs ? ` • ${abs} absence(s)` : ""}</div></div>
      <div class="member-row-actions"><button type="button" class="btn-secondary btn-xs" data-edit-member="${esc(m.id)}">Modifier</button><button type="button" class="btn-secondary btn-xs" data-remove-member="${esc(m.id)}">${isMe ? "Quitter" : "Retirer"}</button></div>
    </div>`;
  }).join("");

  const myUnavails = Object.values(membersObj[myId]?.unavailabilities || {}).sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  $("my-unavailabilities-list").innerHTML = myUnavails.length
    ? myUnavails.map((u) => `<div class="member-row"><div style="min-width:0"><div style="font-size:13.5px"><strong>${esc(u.startDate === u.endDate ? `Le ${formatShortDateFr(u.startDate)}` : `Du ${formatShortDateFr(u.startDate)} au ${formatShortDateFr(u.endDate)}`)}</strong></div>${u.reason ? `<div style="font-size:12.5px;color:var(--muted)">${esc(u.reason)}</div>` : ""}</div><button type="button" class="btn-secondary btn-xs" data-del-unavail="${esc(u.id)}">Supprimer</button></div>`).join("")
    : `<div style="font-size:13px;color:var(--muted);padding-bottom:4px">Aucune période d'indisponibilité enregistrée.</div>`;

  $("saved-ensembles-list").innerHTML = Object.keys(state.session.ensembles).map((id) => {
    const it = state.session.ensembles[id], cur = id === state.session.activeEnsembleId;
    return `<div class="member-row"><div><strong>${esc(it.ensembleName || id)}</strong><div style="font-size:12px;color:var(--muted)">${esc(it.name)} • ${esc(it.instrument)}</div></div>${cur ? `<span style="font-size:12px;font-weight:600;color:var(--yes-fg)">Actif</span>` : `<button type="button" class="btn-secondary btn-sm" data-switch-ens="${esc(id)}">Ouvrir</button>`}</div>`;
  }).join("");
}

export function initEnsembleListeners() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); state.deferredInstallPrompt = e;
    $("install-banner").classList.remove("hidden"); $("tuto-direct-install-card").classList.remove("hidden");
  });

  $("btn-install-pwa").addEventListener("click", triggerNativeInstall);
  $("btn-tuto-direct-install").addEventListener("click", triggerNativeInstall);

  document.querySelectorAll(".tab-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
      if (tab === "ensemble") {
        state.ensembleTapCount++;
        clearTimeout(state.ensembleTapTimer);
        if (state.ensembleTapCount >= 4) { state.ensembleTapCount = 0; return hooks.openAdminPinPrompt(); }
        state.ensembleTapTimer = setTimeout(() => { state.ensembleTapCount = 0; }, 1500);
      } else { state.ensembleTapCount = 0; clearTimeout(state.ensembleTapTimer); }
    });
  });

  $("btn-finish-tuto").addEventListener("click", async () => {
    haptic(); localStorage.setItem(KEYS.tuto, "1");
    $("view-install-tuto").classList.add("hidden");
    await proceedAfterTutorial(); hooks.maybeDisplayLatestAnnouncement();
  });
  $("btn-reopen-tuto").addEventListener("click", () => { haptic(); showInstallTutorial(); });

  let codeLookupTimer = null;
  $("join-code").addEventListener("input", () => {
    clearTimeout(codeLookupTimer);
    const code = extractEnsembleCode($("join-code").value);
    if (code.length < 6) return renderClaimableMembers(null, null);
    codeLookupTimer = setTimeout(async () => {
      try {
        const snap = await get(ref(db, `ensembles/${code}`));
        if (snap.exists()) {
          const d = snap.val();
          $("join-kicker").textContent = `Ensemble trouvé — ${d.formation || "Ensemble"}`;
          $("join-ensemble-title").textContent = d.name;
          renderClaimableMembers(code, d);
        } else renderClaimableMembers(null, null);
      } catch (_) {}
    }, 300);
  });

  $("form-create").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const btn = $("btn-submit-create"); btn.disabled = true;
    try {
      const ensembleName = $("create-ensemble-name").value.trim(), formation = $("create-formation").value;
      const memberName = $("create-member-name").value.trim(), instrument = $("create-member-instrument").value.trim();
      const ensembleId = genId("ens"), memberId = genId("mbr");
      const pushEnabled = "Notification" in window && Notification.permission === "granted";
      const fcmToken = pushEnabled ? await fetchFcmTokenSafe() : null;

      await set(ref(db, `ensembles/${ensembleId}`), {
        id: ensembleId, name: ensembleName, formation, autoRemindEve: true, createdAt: Date.now(),
        members: { [memberId]: { id: memberId, name: memberName, instrument, pushEnabled, ...(fcmToken ? { fcmToken } : {}), joinedAt: Date.now() } }
      });
      $("firebase-error-banner").classList.add("hidden");
      state.session.ensembles[ensembleId] = { memberId, name: memberName, instrument, ensembleName };
      state.session.activeEnsembleId = ensembleId; saveSession();
      enterEnsemble(ensembleId); openModal("modal-invite");
    } catch (err) { handleFirebaseError(err); }
    finally { btn.disabled = false; }
  });

  $("form-join").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const btn = $("btn-submit-join"); btn.disabled = true;
    try {
      const code = extractEnsembleCode($("join-code").value), name = $("join-name").value.trim(), instrument = $("join-instrument").value.trim();
      const snap = await get(ref(db, `ensembles/${code}`));
      $("firebase-error-banner").classList.add("hidden");
      if (!snap.exists()) { showToast("Ensemble introuvable."); return; }

      const d = snap.val();
      const dup = Object.values(d.members || {}).find((m) => m.name?.trim().toLowerCase() === name.toLowerCase());
      const finalizeJoin = async (memberId, finalName, isRestore) => {
        const pushEnabled = isRestore ? Boolean(dup.pushEnabled) : ("Notification" in window && Notification.permission === "granted");
        const fcmToken = (pushEnabled && Notification.permission === "granted") ? await fetchFcmTokenSafe() : null;
        if (isRestore) {
          await update(ref(db, `ensembles/${code}/members/${memberId}`), { instrument, ...(fcmToken ? { fcmToken } : {}) });
        } else {
          await set(ref(db, `ensembles/${code}/members/${memberId}`), { id: memberId, name: finalName, instrument, pushEnabled, ...(fcmToken ? { fcmToken } : {}), joinedAt: Date.now() });
        }
        state.session.ensembles[code] = { memberId, name: finalName, instrument, ensembleName: d.name };
        state.session.activeEnsembleId = code; saveSession();
        window.history.replaceState({}, "", window.location.pathname);
        showToast(isRestore ? `Profil de ${finalName} restauré.` : `Bienvenue dans ${d.name}.`);
        enterEnsemble(code);
      };

      if (dup) {
        openConfirmationModal({
          title: "Profil existant détecté",
          context: `${dup.name} • ${dup.instrument}`,
          message: `Un membre nommé « ${dup.name} » existe déjà. Voulez-vous restaurer ce profil et ses votes plutôt que d'en créer un nouveau ?`,
          confirmLabel: "Restaurer ce profil",
          danger: false,
          onConfirm: () => finalizeJoin(dup.id, dup.name, true)
        });
      } else {
        await finalizeJoin(genId("mbr"), name, false);
      }
    } catch (err) { handleFirebaseError(err); }
    finally { btn.disabled = false; }
  });

  $("view-ensemble").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const membersObj = state.currentEnsembleData?.members || {}, myId = state.session.ensembles[state.session.activeEnsembleId]?.memberId;

    if (btn.dataset.editMember) {
      const m = membersObj[btn.dataset.editMember]; if (!m) return;
      $("edit-member-id").value = m.id; $("edit-member-name").value = m.name || ""; $("edit-member-instrument").value = m.instrument || "";
      return openModal("modal-edit-member");
    }
    if (btn.dataset.removeMember) {
      const tid = btn.dataset.removeMember, m = membersObj[tid]; if (!m) return;
      const isMe = tid === myId;
      return openConfirmationModal({
        title: isMe ? "Quitter cet ensemble ?" : `Retirer ${m.name} ?`,
        context: `${m.name} • ${m.instrument}`,
        message: isMe ? `Vous quitterez « ${state.currentEnsembleData.name} » et vos votes seront retirés.` : `${m.name} sera retiré de l'ensemble ainsi que ses votes.`,
        confirmLabel: isMe ? "Quitter" : "Retirer",
        onConfirm: async () => {
          try {
            const ensId = state.session.activeEnsembleId;
            await remove(ref(db, `ensembles/${ensId}/members/${tid}`));
            await Promise.all(Object.keys(state.currentEnsembleData.polls || {}).flatMap((pid) => [
              remove(ref(db, `ensembles/${ensId}/polls/${pid}/votes/${tid}`)),
              remove(ref(db, `ensembles/${ensId}/polls/${pid}/voteNotes/${tid}`))
            ]));
            if (isMe) {
              delete state.session.ensembles[ensId];
              state.session.activeEnsembleId = Object.keys(state.session.ensembles)[0] || null;
              saveSession(); showToast("Vous avez quitté l'ensemble.");
              state.session.activeEnsembleId ? enterEnsemble(state.session.activeEnsembleId) : (state.unsubscribeEnsemble?.(), showOnboarding());
            } else showToast(`${m.name} a été retiré.`);
          } catch (err) { handleFirebaseError(err); }
        }
      });
    }
    if (btn.dataset.delUnavail) {
      const u = membersObj[myId]?.unavailabilities?.[btn.dataset.delUnavail]; if (!u) return;
      const rTxt = u.startDate === u.endDate ? `Le ${formatShortDateFr(u.startDate)}` : `Du ${formatShortDateFr(u.startDate)} au ${formatShortDateFr(u.endDate)}`;
      return openConfirmationModal({
        title: "Supprimer cette absence ?", context: `${rTxt}${u.reason ? ` — ${u.reason}` : ""}`,
        message: "Cette période ne sera plus signalée.", confirmLabel: "Supprimer",
        onConfirm: async () => {
          try { await remove(ref(db, `ensembles/${state.session.activeEnsembleId}/members/${myId}/unavailabilities/${u.id}`)); showToast("Absence supprimée."); }
          catch (err) { handleFirebaseError(err); }
        }
      });
    }
    if (btn.dataset.switchEns) {
      state.session.activeEnsembleId = btn.dataset.switchEns; saveSession(); enterEnsemble(state.session.activeEnsembleId);
    }
  });

  $("form-unavailability").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const startDate = $("unavail-start").value, endDate = $("unavail-end").value, reason = $("unavail-reason").value.trim();
    const myId = state.session.ensembles[state.session.activeEnsembleId]?.memberId;
    if (!startDate || !endDate || !myId) return;
    if (endDate < startDate) return showToast("La date de fin doit être postérieure ou égale au début.");
    try {
      const id = genId("una");
      await set(ref(db, `ensembles/${state.session.activeEnsembleId}/members/${myId}/unavailabilities/${id}`), { id, startDate, endDate, reason, createdAt: Date.now() });
      $("form-unavailability").reset(); closeModal("modal-unavailability"); showToast("Indisponibilité enregistrée.");
    } catch (err) { handleFirebaseError(err); }
  });

  $("toggle-auto-remind-eve").addEventListener("change", async (e) => {
    haptic(); if (!state.session.activeEnsembleId) return;
    try {
      await update(ref(db, `ensembles/${state.session.activeEnsembleId}`), { autoRemindEve: e.target.checked });
      showToast(e.target.checked ? "Rappel automatique la veille à 19h00 activé." : "Rappel automatique désactivé.");
    } catch (err) { handleFirebaseError(err); }
  });

  $("form-edit-ensemble").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const name = $("edit-ensemble-name").value.trim(), formation = $("edit-ensemble-formation").value;
    if (!name || !state.session.activeEnsembleId) return;
    try {
      await update(ref(db, `ensembles/${state.session.activeEnsembleId}`), { name, formation });
      state.session.ensembles[state.session.activeEnsembleId].ensembleName = name; saveSession();
      closeModal("modal-edit-ensemble"); showToast("Ensemble mis à jour.");
    } catch (err) { handleFirebaseError(err); }
  });

  $("form-edit-member").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const id = $("edit-member-id").value, name = $("edit-member-name").value.trim(), instrument = $("edit-member-instrument").value.trim();
    if (!id || !name || !instrument || !state.session.activeEnsembleId) return;
    try {
      await update(ref(db, `ensembles/${state.session.activeEnsembleId}/members/${id}`), { name, instrument });
      const mySes = state.session.ensembles[state.session.activeEnsembleId];
      if (mySes?.memberId === id) { mySes.name = name; mySes.instrument = instrument; saveSession(); }
      closeModal("modal-edit-member"); showToast("Profil mis à jour.");
    } catch (err) { handleFirebaseError(err); }
  });

  $("btn-open-unavail").addEventListener("click", () => openModal("modal-unavailability"));
  $("btn-open-edit-ensemble").addEventListener("click", () => openModal("modal-edit-ensemble"));
  $("btn-open-transfer").addEventListener("click", () => openModal("modal-transfer-device"));
  $("btn-invite-top").addEventListener("click", () => openModal("modal-invite"));
  $("btn-notif-top").addEventListener("click", togglePushForEnsemble);
  $("btn-toggle-push").addEventListener("click", togglePushForEnsemble);
  $("btn-test-push").addEventListener("click", async () => {
    haptic();
    if (!isEnsemblePushActive()) return showToast("Activez d'abord les notifications.");
    await triggerLocalSystemNotification(`Cadenza — ${state.currentEnsembleData?.name || "Ensemble"}`, "Test réussi : vos notifications fonctionnent.");
    showToast("Notification de test envoyée.");
  });

  $("btn-share-invite").addEventListener("click", () => shareOrCopy(getInviteUrl(state.session.activeEnsembleId), `Cadenza — ${state.currentEnsembleData.name}`, `Rejoignez l'agenda de ${state.currentEnsembleData.name} sur Cadenza :`, "Lien d'invitation copié."));
  $("btn-copy-invite").addEventListener("click", async () => { haptic(); showToast((await copyTextReliable(getInviteUrl(state.session.activeEnsembleId))) ? "Lien d'invitation copié." : "Copiez le lien affiché."); });
  $("btn-native-share").addEventListener("click", () => shareOrCopy(getInviteUrl(state.session.activeEnsembleId), `Cadenza — ${state.currentEnsembleData.name}`, `Rejoignez notre ensemble ${state.currentEnsembleData.name} sur Cadenza :`, "Lien d'invitation copié."));
  $("btn-copy-transfer").addEventListener("click", async () => { haptic(); showToast((await copyTextReliable($("transfer-link-display").textContent)) ? "Lien personnel copié." : "Copiez le lien affiché."); });
  $("btn-share-transfer").addEventListener("click", () => shareOrCopy($("transfer-link-display").textContent, `Cadenza — Profil de ${state.session.ensembles[state.session.activeEnsembleId]?.name || "Musicien"}`, "Ouvrez ce lien sur votre appareil pour retrouver votre profil Cadenza :", "Lien personnel copié."));
  $("btn-switch-onboarding").addEventListener("click", () => { haptic(); state.unsubscribeEnsemble?.(); showOnboarding(); });
}
