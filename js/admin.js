import {
  APP_VERSION, KEYS, db, ref, set, update, remove, onValue,
  state, $, haptic, genId, esc, getVoterDeviceId, getCurrentRespondentLabel,
  showToast, handleFirebaseError, copyTextReliable
} from "./config.js";
import { openConfirmationModal, closeModal } from "./ui.js";

export const POPUP_TYPE_META = {
  poll: { label: "Sondage", defaultBadge: "Sondage", defaultTitle: "Votre avis sur Cadenza", defaultSub: "Quelle option préférez-vous ?" },
  feedback: { label: "Demande d'avis", defaultBadge: "Retour", defaultTitle: "Vos idées & retours", defaultSub: "Aidez-nous à améliorer Cadenza :" },
  message: { label: "Message", defaultBadge: "Info", defaultTitle: "Message de l'équipe Cadenza", defaultSub: "Information importante :" },
  update: { label: "Mise à jour", defaultBadge: APP_VERSION, defaultTitle: "Nouveautés sur Cadenza", defaultSub: "Découvrez les dernières améliorations :" }
};

export function openAdminPinPrompt() {
  haptic();
  $("admin-pin-input").value = "";
  $("admin-pin-error").classList.add("hidden");
  $("modal-admin-pin").classList.add("open");
  setTimeout(() => $("admin-pin-input").focus(), 80);
}

export function switchAdminPortalTab(tab) {
  state.adminActiveTab = tab;
  document.querySelectorAll("[data-admin-tab]").forEach((b) => b.classList.toggle("active", b.dataset.adminTab === tab));
  $("admin-panel-publish").classList.toggle("hidden", tab !== "publish");
  $("admin-panel-results").classList.toggle("hidden", tab !== "results");
  if (tab === "results") renderAdminResultsPanel();
}

export function setAdminPopupType(type) {
  state.adminPopupType = POPUP_TYPE_META[type] ? type : "poll";
  document.querySelectorAll("[data-popup-type]").forEach((b) => b.classList.toggle("active", b.dataset.popupType === state.adminPopupType));
  $("admin-fields-poll").classList.toggle("hidden", state.adminPopupType !== "poll");
  $("admin-fields-feedback").classList.toggle("hidden", state.adminPopupType !== "feedback");
  $("admin-fields-message").classList.toggle("hidden", state.adminPopupType !== "message");
  $("admin-fields-update").classList.toggle("hidden", state.adminPopupType !== "update");

  const meta = POPUP_TYPE_META[state.adminPopupType];
  $("admin-ann-version").placeholder = `Ex: ${meta.defaultBadge}`;
  if (!$("admin-ann-version").dataset.touched) $("admin-ann-version").value = meta.defaultBadge;
  if (!$("admin-ann-title").dataset.touched) $("admin-ann-title").value = meta.defaultTitle;
  $("lbl-admin-subtitle").textContent = state.adminPopupType === "poll" ? "Question du sondage" : state.adminPopupType === "feedback" ? "Question posée aux utilisateurs" : "Sous-titre (optionnel)";
  $("admin-ann-subtitle").placeholder = meta.defaultSub;
  if (state.adminPopupType === "poll") renderAdminPollOptionsBuilder();
}

export function renderAdminPollOptionsBuilder() {
  const box = $("admin-poll-options-list");
  box.innerHTML = state.adminPollOptions.map((opt, idx) => `
    <div class="poll-opt-builder-row">
      <input type="text" class="admin-poll-opt-input" data-opt-idx="${idx}" value="${esc(opt)}" placeholder="Option ${idx + 1} (ex: Oui, Non...)" />
      ${state.adminPollOptions.length > 2 ? `<button type="button" class="btn-remove-opt" data-del-opt="${idx}" aria-label="Retirer cette option">✕</button>` : ""}
    </div>`).join("");
}

export function refreshAdminAnnouncementStatusUI() {
  const box = $("admin-current-announcement"), retest = $("btn-admin-retest-popup"), clear = $("btn-admin-clear-announcement");
  const latest = state.latestAnnouncementData;
  if (!latest?.active) {
    box.textContent = "Aucune pop-up publiée actuellement.";
    retest.classList.add("hidden"); clear.classList.add("hidden");
    return;
  }
  const pType = latest.type || "update";
  const typeLabel = POPUP_TYPE_META[pType]?.label || "Annonce";
  const d = latest.publishedAt ? new Date(latest.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  box.innerHTML = `
    <div style="color:var(--fg);font-weight:600">
      <span class="event-type-badge" style="margin-right:5px">${esc(typeLabel)}</span>
      ${esc(latest.title || "Pop-up")}
      ${latest.version ? `<span class="whats-new-badge" style="margin-left:6px;margin-bottom:0">${esc(latest.version)}</span>` : ""}
    </div>
    ${latest.subtitle ? `<div style="font-size:12.5px;color:var(--fg);margin-top:3px">${esc(latest.subtitle)}</div>` : ""}
    ${d ? `<div style="font-size:12px;margin-top:2px">Publiée le ${esc(d)}</div>` : ""}`;
  retest.classList.remove("hidden"); clear.classList.remove("hidden");
}

export function buildAdminAnnouncementPayload(id) {
  const type = state.adminPopupType;
  const version = $("admin-ann-version").value.trim() || POPUP_TYPE_META[type].defaultBadge;
  const title = $("admin-ann-title").value.trim() || POPUP_TYPE_META[type].defaultTitle;
  const subtitle = $("admin-ann-subtitle").value.trim();

  if (type === "poll") {
    const cleanOpts = state.adminPollOptions.map((o) => String(o || "").trim()).filter(Boolean);
    if (cleanOpts.length < 2) {
      showToast("Ajoutez au moins 2 choix de vote.");
      return null;
    }
    return {
      id, active: true, type: "poll", version, title,
      subtitle: subtitle || "Faites votre choix ci-dessous :",
      options: cleanOpts,
      allowComment: $("admin-poll-allow-comment").checked,
      publishedAt: Date.now()
    };
  }

  if (type === "feedback") {
    const ph = $("admin-feedback-placeholder").value.trim() || "Écrivez votre retour ou suggestion ici...";
    if (!subtitle) {
      showToast("Indiquez la question posée aux utilisateurs.");
      return null;
    }
    return {
      id, active: true, type: "feedback", version, title, subtitle,
      placeholder: ph, publishedAt: Date.now()
    };
  }

  if (type === "message") {
    const body = $("admin-message-body").value.trim();
    if (!body) {
      showToast("Écrivez le contenu du message à afficher.");
      return null;
    }
    return {
      id, active: true, type: "message", version, title, subtitle,
      body, ctaLabel: $("admin-message-cta").value.trim() || "J'ai compris, fermer",
      publishedAt: Date.now()
    };
  }

  const items = $("admin-ann-notes").value.split("\n").map((l) => l.replace(/^[-•*✓]\s*/, "").trim()).filter(Boolean);
  if (!items.length) {
    showToast("Ajoutez au moins une nouveauté.");
    return null;
  }
  return {
    id, active: true, type: "update", version, title,
    subtitle: subtitle || "Découvrez les dernières améliorations :",
    items, publishedAt: Date.now()
  };
}

// Affichage de la pop-up côté utilisateur (Mise à jour, Sondage, Avis ou Message libre)
export function showWhatsNewModal(ann, isPreview = false) {
  if (!ann) return;
  state.isPreviewingWhatsNew = isPreview;
  state.currentRenderedPopupData = ann;
  state.displayedAnnouncementId = ann.id || null;
  state.selectedUserPollOptionIndex = null;

  const pType = ann.type || "update";
  $("whats-new-title").textContent = ann.title || "Cadenza";
  $("whats-new-version-badge").textContent = ann.version ? (isPreview ? `Aperçu • ${ann.version}` : ann.version) : (isPreview ? "Aperçu" : "Information");

  const subEl = $("whats-new-subtitle");
  if (ann.subtitle) {
    subEl.textContent = ann.subtitle;
    subEl.classList.remove("hidden");
  } else {
    subEl.classList.add("hidden");
  }

  const dEl = $("whats-new-date");
  if (ann.publishedAt) {
    dEl.textContent = new Date(ann.publishedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    dEl.classList.remove("hidden");
  } else dEl.classList.add("hidden");

  const bodyEl = $("whats-new-dynamic-body");
  const footerEl = $("whats-new-footer-actions");

  if (pType === "poll") {
    const opts = Array.isArray(ann.options) ? ann.options : [];
    bodyEl.innerHTML = `
      <div class="user-poll-options-list" id="user-poll-options-list">
        ${opts.map((opt, idx) => `
          <button type="button" class="user-poll-option-btn" data-user-poll-opt="${idx}">
            <span class="poll-radio-circle"></span>
            <span>${esc(opt)}</span>
          </button>`).join("")}
      </div>
      ${ann.allowComment ? `
        <div class="field" style="margin-bottom: 14px;">
          <label for="user-popup-comment-input">Commentaire ou précision (facultatif)</label>
          <textarea id="user-popup-comment-input" rows="2" maxlength="400" placeholder="Ajoutez une remarque si vous le souhaitez..."></textarea>
        </div>` : ""}`;

    footerEl.innerHTML = `
      <button type="button" id="btn-submit-user-popup-response" class="btn-confirm btn-full">Envoyer mon vote</button>
      <button type="button" id="btn-skip-user-popup" class="btn-secondary btn-sm btn-full">Fermer sans voter</button>`;
  } else if (pType === "feedback") {
    bodyEl.innerHTML = `
      <div class="field" style="margin-bottom: 14px;">
        <label for="user-popup-comment-input">Votre réponse</label>
        <textarea id="user-popup-comment-input" rows="4" maxlength="600" placeholder="${esc(ann.placeholder || "Écrivez votre retour ici...")}"></textarea>
      </div>`;

    footerEl.innerHTML = `
      <button type="button" id="btn-submit-user-popup-response" class="btn-confirm btn-full">Envoyer mon retour</button>
      <button type="button" id="btn-skip-user-popup" class="btn-secondary btn-sm btn-full">Fermer sans répondre</button>`;
  } else if (pType === "message") {
    bodyEl.innerHTML = `<div class="message-free-box">${esc(ann.body || ann.message || "")}</div>`;
    footerEl.innerHTML = `<button type="button" id="btn-skip-user-popup" class="btn-primary btn-full">${esc(ann.ctaLabel || "J'ai compris, fermer")}</button>`;
  } else {
    const lines = Array.isArray(ann.items) ? ann.items : String(ann.message || "").split("\n").map((l) => l.replace(/^[-•*✓]\s*/, "").trim()).filter(Boolean);
    bodyEl.innerHTML = `<ul class="release-notes-list">${lines.map((l) => `<li><span class="release-notes-check">✓</span><span>${esc(l)}</span></li>`).join("")}</ul>`;
    footerEl.innerHTML = `<button type="button" id="btn-skip-user-popup" class="btn-primary btn-full">J'ai compris, fermer</button>`;
  }

  $("modal-whats-new").classList.add("open");
}

export function dismissWhatsNewModal() {
  haptic();
  if (!state.isPreviewingWhatsNew && state.displayedAnnouncementId) localStorage.setItem(KEYS.ann, state.displayedAnnouncementId);
  state.isPreviewingWhatsNew = false;
  closeModal("modal-whats-new");
}

export function maybeDisplayLatestAnnouncement() {
  const latest = state.latestAnnouncementData;
  if (!latest?.active || !latest?.id || !$("view-install-tuto").classList.contains("hidden")) return;
  if (localStorage.getItem(KEYS.ann) !== latest.id) showWhatsNewModal(latest, false);
}

export function updateAdminResultsBadge() {
  const badge = $("admin-results-badge");
  let totalResponses = 0;
  Object.values(state.allFeedbackCampaigns).forEach((camp) => {
    totalResponses += Object.keys(camp?.responses || {}).length;
  });
  badge.textContent = String(totalResponses);
  badge.classList.toggle("hidden", totalResponses === 0);
}

export function renderAdminResultsPanel() {
  $("admin-feedback-rules-warning").classList.toggle("hidden", !state.feedbackPermissionDenied);

  const campaignsMap = { ...state.allFeedbackCampaigns };
  const latest = state.latestAnnouncementData;
  if (latest?.id && (latest.type === "poll" || latest.type === "feedback") && !campaignsMap[latest.id]) {
    campaignsMap[latest.id] = { meta: latest, responses: {} };
  }

  const campaigns = Object.values(campaignsMap)
    .filter((c) => c?.meta)
    .sort((a, b) => (b.meta.publishedAt || 0) - (a.meta.publishedAt || 0));

  if (!campaigns.length) {
    $("admin-results-empty").classList.remove("hidden");
    $("admin-results-content").classList.add("hidden");
    return;
  }

  $("admin-results-empty").classList.add("hidden");
  $("admin-results-content").classList.remove("hidden");

  const select = $("admin-results-campaign-select");
  if (!state.selectedResultsCampaignId || !campaignsMap[state.selectedResultsCampaignId]) {
    state.selectedResultsCampaignId = (latest?.id && campaignsMap[latest.id]) ? latest.id : campaigns[0].meta.id;
  }

  select.innerHTML = campaigns.map((c) => {
    const count = Object.keys(c.responses || {}).length;
    const tLabel = POPUP_TYPE_META[c.meta.type]?.label || "Campagne";
    const isCurrent = c.meta.id === latest?.id && latest?.active;
    return `<option value="${esc(c.meta.id)}" ${c.meta.id === state.selectedResultsCampaignId ? "selected" : ""}>[${tLabel}] ${esc(c.meta.title || "Sans titre")} (${count} rép.)${isCurrent ? " — Actif" : ""}</option>`;
  }).join("");

  const activeCamp = campaignsMap[state.selectedResultsCampaignId] || campaigns[0];
  const meta = activeCamp.meta || {};
  const responses = Object.values(activeCamp.responses || {}).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));

  $("res-campaign-badge").textContent = `${POPUP_TYPE_META[meta.type]?.label || "Campagne"}${meta.version ? ` • ${meta.version}` : ""}`;
  $("res-campaign-title").textContent = meta.title || "Sondage";
  $("res-campaign-subtitle").textContent = meta.subtitle || "";
  $("res-total-count").textContent = `${responses.length} réponse${responses.length > 1 ? "s" : ""}`;

  const barsBox = $("res-poll-bars-container");
  if (meta.type === "poll" && Array.isArray(meta.options) && meta.options.length) {
    barsBox.classList.remove("hidden");
    const counts = meta.options.map((_, idx) => responses.filter((r) => r.optionIndex === idx).length);
    const maxCount = Math.max(...counts, 0);

    barsBox.innerHTML = meta.options.map((opt, idx) => {
      const c = counts[idx];
      const pct = responses.length > 0 ? Math.round((c / responses.length) * 100) : 0;
      const isWinner = maxCount > 0 && c === maxCount;
      return `
        <div class="result-stat-row">
          <div class="result-stat-head">
            <span style="font-weight:${isWinner ? "700" : "500"}">${esc(opt)}</span>
            <span style="font-weight:700;color:${isWinner ? "var(--yes-fg)" : "var(--muted)"}">${c} (${pct}%)</span>
          </div>
          <div class="result-bar-track">
            <div class="result-bar-fill ${isWinner ? "winner" : ""}" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join("");
  } else {
    barsBox.classList.add("hidden");
    barsBox.innerHTML = "";
  }

  const comments = responses.filter((r) => Boolean(r.comment));
  $("res-comments-count").textContent = String(comments.length);
  $("res-comments-list").innerHTML = comments.length
    ? comments.map((r) => {
        const dStr = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        return `
          <div class="feedback-response-card">
            <div class="feedback-response-meta">
              <strong>${esc(r.respondent || "Utilisateur")}</strong>
              <span>${esc(dStr)}</span>
            </div>
            ${r.optionLabel ? `<div style="font-size:11.5px;color:var(--accent-fg);font-weight:600;margin-bottom:3px">Vote : ${esc(r.optionLabel)}</div>` : ""}
            <div style="white-space:pre-line;color:var(--fg)">${esc(r.comment)}</div>
          </div>`;
      }).join("")
    : `<div style="font-size:13px;color:var(--muted)">Aucun commentaire écrit pour le moment.</div>`;
}

export function initAdminListeners() {
  document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      haptic();
      switchAdminPortalTab(btn.dataset.adminTab);
    });
  });

  ["admin-ann-version", "admin-ann-title"].forEach((id) => {
    $(id).addEventListener("input", () => { $(id).dataset.touched = "1"; });
  });

  document.querySelectorAll("[data-popup-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      haptic();
      setAdminPopupType(btn.dataset.popupType);
    });
  });

  $("admin-poll-options-list").addEventListener("input", (e) => {
    const inp = e.target.closest(".admin-poll-opt-input");
    if (inp) state.adminPollOptions[Number(inp.dataset.optIdx)] = inp.value;
  });

  $("admin-poll-options-list").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del-opt]");
    if (!del || state.adminPollOptions.length <= 2) return;
    haptic();
    state.adminPollOptions.splice(Number(del.dataset.delOpt), 1);
    renderAdminPollOptionsBuilder();
  });

  $("btn-admin-add-option").addEventListener("click", () => {
    haptic();
    state.adminPollOptions.push("");
    renderAdminPollOptionsBuilder();
    const inputs = $("admin-poll-options-list").querySelectorAll(".admin-poll-opt-input");
    inputs[inputs.length - 1]?.focus();
  });

  $("whats-new-dynamic-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-user-poll-opt]");
    if (!btn) return;
    haptic();
    state.selectedUserPollOptionIndex = Number(btn.dataset.userPollOpt);
    $("whats-new-dynamic-body").querySelectorAll(".user-poll-option-btn").forEach((b) => {
      const isSel = Number(b.dataset.userPollOpt) === state.selectedUserPollOptionIndex;
      b.classList.toggle("selected", isSel);
      b.querySelector(".poll-radio-circle").textContent = isSel ? "✓" : "";
    });
  });

  $("whats-new-footer-actions").addEventListener("click", async (e) => {
    if (e.target.closest("#btn-skip-user-popup")) {
      return dismissWhatsNewModal();
    }
    const submitBtn = e.target.closest("#btn-submit-user-popup-response");
    if (!submitBtn || !state.currentRenderedPopupData) return;
    haptic();

    const ann = state.currentRenderedPopupData;
    const pType = ann.type || "update";
    const commentVal = $("user-popup-comment-input")?.value.trim() || "";

    if (pType === "poll" && state.selectedUserPollOptionIndex === null) {
      return showToast("Sélectionnez une option avant d'envoyer votre vote.");
    }
    if (pType === "feedback" && !commentVal) {
      return showToast("Écrivez un message avant d'envoyer votre retour.");
    }

    if (state.isPreviewingWhatsNew) {
      showToast("Aperçu : votre réponse a bien été simulée.");
      return dismissWhatsNewModal();
    }

    submitBtn.disabled = true;
    const voterId = getVoterDeviceId();
    const optionLabel = pType === "poll" ? (ann.options?.[state.selectedUserPollOptionIndex] || "") : "";

    try {
      await update(ref(db, `app_feedback/${ann.id}`), {
        meta: {
          id: ann.id,
          type: pType,
          version: ann.version || "",
          title: ann.title || "",
          subtitle: ann.subtitle || "",
          options: ann.options || null,
          publishedAt: ann.publishedAt || Date.now()
        },
        [`responses/${voterId}`]: {
          voterId,
          respondent: getCurrentRespondentLabel(),
          optionIndex: pType === "poll" ? state.selectedUserPollOptionIndex : null,
          optionLabel,
          comment: commentVal,
          submittedAt: Date.now()
        }
      });
      showToast(pType === "poll" ? "Merci ! Votre vote a été enregistré." : "Merci ! Votre retour a été envoyé.");
      dismissWhatsNewModal();
    } catch (err) {
      console.warn("Feedback write error:", err);
      showToast("Impossible d'enregistrer la réponse (vérifiez les règles Firebase).");
      dismissWhatsNewModal();
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Écoute Firebase des annonces & retours
  onValue(ref(db, "app_announcements/latest/public"), (snap) => {
    state.latestAnnouncementData = snap.exists() ? snap.val() : null;
    refreshAdminAnnouncementStatusUI();
    maybeDisplayLatestAnnouncement();
  }, () => {});

  onValue(ref(db, "app_feedback"), (snap) => {
    state.feedbackPermissionDenied = false;
    state.allFeedbackCampaigns = snap.exists() ? (snap.val() || {}) : {};
    updateAdminResultsBadge();
    if (state.adminActiveTab === "results" && $("modal-admin-portal").classList.contains("open")) {
      renderAdminResultsPanel();
    }
  }, (err) => {
    if (String(err?.message || "").toLowerCase().includes("permission") || err?.code === "PERMISSION_DENIED") {
      state.feedbackPermissionDenied = true;
      if (state.adminActiveTab === "results" && $("modal-admin-portal").classList.contains("open")) {
        renderAdminResultsPanel();
      }
    }
  });

  $("admin-results-campaign-select").addEventListener("change", (e) => {
    state.selectedResultsCampaignId = e.target.value;
    renderAdminResultsPanel();
  });

  $("btn-copy-fb-rule").addEventListener("click", async () => {
    haptic();
    const ok = await copyTextReliable($("firebase-feedback-rule-snippet").textContent);
    showToast(ok ? "Règle Firebase copiée." : "Copiez la règle affichée.");
  });

  $("btn-admin-delete-campaign-results").addEventListener("click", () => {
    if (!state.selectedResultsCampaignId || !state.verifiedAdminPin) return;
    const campId = state.selectedResultsCampaignId;
    openConfirmationModal({
      title: "Supprimer ces résultats ?",
      context: $("res-campaign-title").textContent,
      message: "Tous les votes et commentaires associés à cette campagne seront définitivement effacés.",
      confirmLabel: "Supprimer les résultats",
      onConfirm: async () => {
        try {
          await remove(ref(db, `app_feedback/${campId}`));
          state.selectedResultsCampaignId = null;
          showToast("Résultats supprimés.");
        } catch (err) {
          handleFirebaseError(err);
        }
      }
    });
  });

  $("form-admin-pin").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const entered = $("admin-pin-input").value.trim();
    const btn = $("btn-submit-admin-pin");
    btn.disabled = true; $("admin-pin-error").classList.add("hidden");
    try {
      await set(ref(db, "admin_sessions/last_check"), { pin: entered, ts: Date.now() });
      state.verifiedAdminPin = entered;
      closeModal("modal-admin-pin");
      $("admin-firebase-warning").classList.add("hidden");
      delete $("admin-ann-version").dataset.touched;
      delete $("admin-ann-title").dataset.touched;
      setAdminPopupType(state.adminPopupType);
      switchAdminPortalTab("publish");
      refreshAdminAnnouncementStatusUI();
      $("modal-admin-portal").classList.add("open");
    } catch (_) {
      state.verifiedAdminPin = null;
      $("admin-pin-error").classList.remove("hidden");
      $("admin-pin-input").value = ""; $("admin-pin-input").focus();
    } finally { btn.disabled = false; }
  });

  $("btn-admin-preview").addEventListener("click", () => {
    haptic();
    const payload = buildAdminAnnouncementPayload("preview");
    if (!payload) return;
    showWhatsNewModal(payload, true);
  });

  $("form-admin-announcement").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    if (!state.verifiedAdminPin) { closeModal("modal-admin-portal"); return openAdminPinPrompt(); }
    const newId = genId("ann");
    const payload = buildAdminAnnouncementPayload(newId);
    if (!payload) return;

    const btn = $("btn-admin-publish");
    btn.disabled = true;
    try {
      await set(ref(db, "app_announcements/latest"), {
        public: payload,
        auth: { pin: state.verifiedAdminPin }
      });
      if (payload.type === "poll" || payload.type === "feedback") {
        set(ref(db, `app_feedback/${newId}/meta`), payload).catch(() => {});
        state.selectedResultsCampaignId = newId;
      }
      localStorage.setItem(KEYS.ann, newId);
      closeModal("modal-admin-portal");
      showToast("Pop-up publiée pour tous les utilisateurs !");
    } catch (_) { $("admin-firebase-warning").classList.remove("hidden"); showToast("Accès refusé par Firebase."); }
    finally { btn.disabled = false; }
  });

  $("btn-admin-retest-popup").addEventListener("click", () => {
    if (!state.latestAnnouncementData) return;
    localStorage.removeItem(KEYS.ann);
    closeModal("modal-admin-portal");
    showWhatsNewModal(state.latestAnnouncementData, false);
  });

  $("btn-admin-clear-announcement").addEventListener("click", async () => {
    haptic();
    if (!state.verifiedAdminPin) { closeModal("modal-admin-portal"); return openAdminPinPrompt(); }
    try {
      await set(ref(db, "app_announcements/latest"), { public: { ...(state.latestAnnouncementData || {}), active: false }, auth: { pin: state.verifiedAdminPin } });
      showToast("La pop-up a été désactivée.");
    } catch (_) { $("admin-firebase-warning").classList.remove("hidden"); }
  });

  $("btn-close-whats-new-top").addEventListener("click", dismissWhatsNewModal);
}
