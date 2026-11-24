import {
  db, ref, set, update, remove,
  state, $, haptic, genId, esc, getEventMeta,
  showToast, handleFirebaseError, formatDateFr
} from "./config.js";
import {
  setEventTypeValue, syncConcertFieldsVisibility, readConcertFields, populateConcertFields,
  openConfirmationModal, openModal, closeModal
} from "./ui.js";

let hooks = {
  publishEnsembleNotification: async () => {},
  switchTab: () => {}
};

export function registerAgendaHooks(h) {
  hooks = { ...hooks, ...h };
}

// Rendu Agenda (Répétitions, Cours & Concerts)
export function renderAgenda() {
  const container = $("agenda-list"), rehObj = state.currentEnsembleData.rehearsals || {};
  const list = Object.values(rehObj).sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><p>Aucun événement planifié pour le moment.</p><button type="button" class="btn-secondary btn-sm" data-go-avail>Proposer des disponibilités</button></div>`;
    return;
  }
  const today = new Date().toISOString().split("T")[0];
  const upcoming = list.filter((r) => r.date >= today), past = list.filter((r) => r.date < today).reverse();

  const cardHtml = (r, isNext, isPast) => {
    const tMeta = getEventMeta(r.eventType);
    const isConcert = r.eventType === "concert";
    const concertInfos = [];
    if (isConcert && r.soundcheckTime) concertInfos.push(`<span class="concert-detail-item"><strong>Raccord :</strong> ${esc(r.soundcheckTime)}</span>`);
    if (isConcert && r.dressCode) concertInfos.push(`<span class="concert-detail-item"><strong>Tenue :</strong> ${esc(r.dressCode)}</span>`);
    if (isConcert && r.concertFee) concertInfos.push(`<span class="concert-detail-item"><strong>Cachet / Tarif :</strong> ${esc(r.concertFee)}</span>`);

    const kickerHtml = isNext
      ? `<div class="card-kicker ${isConcert ? "concert" : r.eventType === "cours" ? "cours" : "emerald"}">${esc(tMeta.nextLabel)}</div>`
      : "";

    return `
    <article class="card ${isNext ? "featured" : ""} ${tMeta.cardCls}" ${isPast ? 'style="opacity:.72"' : ""}>
      ${kickerHtml}
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <h3 class="card-date" ${isPast ? 'style="font-size:16px"' : ""}>${esc(formatDateFr(r.date))}</h3>
        <span class="event-type-badge ${tMeta.badgeCls}">${esc(tMeta.label)}</span>
      </div>
      <div class="card-meta" style="margin-top:4px">${isPast ? `${esc(r.startTime)} – ${esc(r.endTime)} • ${esc(r.location)}` : `<span class="time-pill">${esc(r.startTime)} – ${esc(r.endTime)}</span> <strong>${esc(r.location)}</strong>`}</div>
      ${concertInfos.length ? `<div class="concert-details-grid">${concertInfos.join(" • ")}</div>` : ""}
      ${r.program ? `<div class="${isPast ? "card-meta" : "card-program"}">${isPast ? "" : "<strong>Programme :</strong> "}${esc(r.program)}</div>` : ""}
      ${!isPast && r.notes ? `<div class="card-meta" style="margin-top:6px">${esc(r.notes)}</div>` : ""}
      <div class="card-actions">
        ${isPast ? "" : `<button type="button" class="btn-secondary btn-sm" data-ics="${esc(r.id)}">Calendrier (.ics)</button>`}
        <button type="button" class="btn-secondary ${isPast ? "btn-xs" : "btn-sm"}" data-edit-reh="${esc(r.id)}">Modifier</button>
        <button type="button" class="btn-secondary ${isPast ? "btn-xs" : "btn-sm"}" data-del-reh="${esc(r.id)}">${isPast ? "Supprimer" : "Annuler"}</button>
      </div>
    </article>`;
  };

  container.innerHTML = upcoming.map((r, i) => cardHtml(r, i === 0, false)).join("")
    + (past.length ? `<div class="divider">Événements passés (${past.length})</div>${past.map((r) => cardHtml(r, false, true)).join("")}` : "");
}

export function downloadICS(reh) {
  if (!reh) return;
  haptic();
  const tMeta = getEventMeta(reh.eventType);
  const fmt = (d, t) => `${d.replace(/-/g, "")}T${t.replace(":", "")}00`;
  const desc = [
    reh.soundcheckTime ? `Raccord sur place : ${reh.soundcheckTime}` : "",
    reh.dressCode ? `Tenue de scène : ${reh.dressCode}` : "",
    reh.concertFee ? `Cachet / Billetterie : ${reh.concertFee}` : "",
    reh.program ? `Programme : ${reh.program}` : "",
    reh.notes || ""
  ].filter(Boolean).join("\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cadenza//FR", "BEGIN:VEVENT", `UID:${reh.id}@cadenza.app`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`, `DTSTART:${fmt(reh.date, reh.startTime)}`, `DTEND:${fmt(reh.date, reh.endTime)}`, `SUMMARY:${tMeta.label} — ${state.currentEnsembleData.name}`, `LOCATION:${reh.location || ""}`, `DESCRIPTION:${desc}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" })), download: `cadenza-${reh.date}.ics` });
  a.click(); URL.revokeObjectURL(a.href); showToast("Fichier calendrier (.ics) téléchargé.");
}

export function initAgendaListeners() {
  $("agenda-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.hasAttribute("data-go-avail")) return hooks.switchTab("avail");
    const rehObj = state.currentEnsembleData?.rehearsals || {};
    if (btn.dataset.ics) return downloadICS(rehObj[btn.dataset.ics]);
    if (btn.dataset.editReh) {
      const r = rehObj[btn.dataset.editReh]; if (!r) return;
      const type = r.eventType || "rehearsal";
      setEventTypeValue($("edit-reh-type-holder"), type, (t) => syncConcertFieldsVisibility("edit-reh", t, "lbl-edit-reh-start", "lbl-edit-reh-end"));
      $("modal-edit-reh-title").textContent = type === "concert" ? "Modifier le concert" : type === "cours" ? "Modifier le cours" : "Modifier la répétition";
      $("edit-reh-id").value = r.id; $("edit-reh-date").value = r.date || "";
      $("edit-reh-start").value = r.startTime || "14:00"; $("edit-reh-end").value = r.endTime || "17:00";
      populateConcertFields("edit-reh", r);
      $("edit-reh-location").value = r.location || ""; $("edit-reh-program").value = r.program || ""; $("edit-reh-notes").value = r.notes || "";
      return openModal("modal-edit-rehearsal");
    }
    if (btn.dataset.delReh) {
      const r = rehObj[btn.dataset.delReh]; if (!r) return;
      const tMeta = getEventMeta(r.eventType);
      openConfirmationModal({
        title: `Supprimer ce ${tMeta.label.toLowerCase()} ?`,
        context: `${tMeta.label} • ${formatDateFr(r.date)} • ${r.startTime}–${r.endTime} (${r.location})`,
        message: "Cet événement sera retiré de l'agenda de tout l'ensemble.",
        confirmLabel: "Supprimer",
        onConfirm: async () => {
          try { await remove(ref(db, `ensembles/${state.session.activeEnsembleId}/rehearsals/${r.id}`)); showToast(`${tMeta.label} retiré(e) de l'agenda.`); }
          catch (err) { handleFirebaseError(err); }
        }
      });
    }
  });

  $("form-edit-rehearsal").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const rehId = $("edit-reh-id").value, date = $("edit-reh-date").value, startTime = $("edit-reh-start").value, endTime = $("edit-reh-end").value;
    const eventType = $("edit-reh-type-holder").dataset.value || "rehearsal";
    const concertData = readConcertFields("edit-reh", eventType);
    const location = $("edit-reh-location").value.trim(), program = $("edit-reh-program").value.trim(), notes = $("edit-reh-notes").value.trim();
    if (!rehId || !state.session.activeEnsembleId) return;
    try {
      await update(ref(db, `ensembles/${state.session.activeEnsembleId}/rehearsals/${rehId}`), {
        eventType, date, startTime, endTime, ...concertData, location, program, notes, updatedAt: Date.now()
      });
      await hooks.publishEnsembleNotification(`${getEventMeta(eventType).label} modifié(e) — ${state.currentEnsembleData?.name || "Cadenza"}`, `${formatDateFr(date)} • ${startTime}–${endTime} • ${location}`);
      closeModal("modal-edit-rehearsal"); showToast("Agenda mis à jour.");
    } catch (err) { handleFirebaseError(err); }
  });

  $("form-rehearsal").addEventListener("submit", async (e) => {
    e.preventDefault(); haptic();
    const eventType = $("reh-type-holder").dataset.value || "rehearsal";
    const concertData = readConcertFields("reh", eventType);
    const date = $("reh-date").value, startTime = $("reh-start").value, endTime = $("reh-end").value;
    const location = $("reh-location").value.trim(), program = $("reh-program").value.trim(), notes = $("reh-notes").value.trim();
    const tMeta = getEventMeta(eventType);
    try {
      const id = genId("reh");
      await set(ref(db, `ensembles/${state.session.activeEnsembleId}/rehearsals/${id}`), {
        id, eventType, date, startTime, endTime, ...concertData, location, program, notes, createdAt: Date.now()
      });
      await hooks.publishEnsembleNotification(`${tMeta.label} ajouté(e) — ${state.currentEnsembleData.name}`, `${formatDateFr(date)} • ${startTime}–${endTime} (${location})`);
      $("form-rehearsal").reset(); closeModal("modal-rehearsal"); showToast(`${tMeta.label} ajouté(e) à l'agenda.`); hooks.switchTab("agenda");
    } catch (err) { handleFirebaseError(err); }
  });

  $("btn-open-rehearsal").addEventListener("click", () => openModal("modal-rehearsal"));
}
