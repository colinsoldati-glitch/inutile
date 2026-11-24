import { APP_VERSION, KEYS, $ } from "./config.js";
import {
  registerUiHooks, initFormSelectors, initCalendarControls, initModalGlobalListeners
} from "./ui.js";
import {
  openAdminPinPrompt, maybeDisplayLatestAnnouncement, dismissWhatsNewModal, initAdminListeners
} from "./admin.js";
import {
  registerPollsHooks, archiveFailedPollsIfNeeded, renderPolls,
  updatePollConflictsWarning, checkEditPollArchiveLock, resetPollSlots, initPollsListeners
} from "./polls.js";
import {
  registerAgendaHooks, renderAgenda, initAgendaListeners
} from "./agenda.js";
import {
  registerEnsembleHooks, initServiceWorkerAndPush, showInstallTutorial,
  proceedAfterTutorial, publishEnsembleNotification, switchTab, initEnsembleListeners
} from "./ensemble.js";

$("app-version-label").textContent = APP_VERSION;

// Connexion des modules entre eux (évite les dépendances circulaires)
registerUiHooks({
  updatePollConflictsWarning,
  checkEditPollArchiveLock,
  resetPollSlots,
  dismissWhatsNewModal
});

registerPollsHooks({
  publishEnsembleNotification,
  switchTab
});

registerAgendaHooks({
  publishEnsembleNotification,
  switchTab
});

registerEnsembleHooks({
  archiveFailedPollsIfNeeded,
  renderPolls,
  renderAgenda,
  openAdminPinPrompt,
  maybeDisplayLatestAnnouncement
});

// Initialisation de l'interface et des écouteurs
initFormSelectors();
initCalendarControls();
initModalGlobalListeners();
initAdminListeners();
initPollsListeners();
initAgendaListeners();
initEnsembleListeners();

// Démarrage de l'application
(async function init() {
  const p = new URLSearchParams(window.location.search);
  if (p.get("ensemble")) {
    localStorage.setItem(KEYS.invite, JSON.stringify({
      ensembleId: p.get("ensemble"),
      memberId: p.get("member") || null
    }));
  }
  await initServiceWorkerAndPush();
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) localStorage.setItem(KEYS.tuto, "1");
  if (!localStorage.getItem(KEYS.tuto) && !isStandalone) showInstallTutorial();
  else {
    await proceedAfterTutorial();
    maybeDisplayLatestAnnouncement();
  }
})();
