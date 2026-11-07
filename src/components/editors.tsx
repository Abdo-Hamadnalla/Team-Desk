'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, Check, Download, History, LayoutGrid, Pencil, Plus, RotateCcw, Users, X } from 'lucide-react';
import type { Activity, Meeting, OperationType, Person, Priority, Status, Task, Workspace } from '@/lib/types';
import type { Language, MessageKey, Translate } from '@/lib/i18n';

export type Mutate = (type: OperationType, payload: Record<string, unknown>, expectedUpdatedAt?: string) => Promise<boolean>;

interface CommonProps {
  workspace: Workspace;
  t: Translate;
  lang: Language;
  busy: boolean;
  mutate: Mutate;
  onClose: () => void;
  error?: string;
}

const statuses: Status[] = ['todo', 'progress', 'review', 'done'];
const priorities: Priority[] = ['low', 'medium', 'high'];

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateTime(value: string, lang: Language) {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
}

export function Sheet({ title, subtitle, dirty, busy, onClose, t, children, footer, lang, error }: {
  title: string; subtitle?: string; dirty: boolean; busy: boolean; onClose: () => void; t: Translate;
  children: ReactNode; footer?: ReactNode; lang: Language; error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = () => {
    if (busy) return;
    if (!dirty || window.confirm(t('discard'))) onClose();
  };
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  return <dialog ref={ref} className="sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <header className="sheet-header">
      <div><h2 id={titleId} className="sheet-title">{title}</h2>{subtitle && <p className="muted small">{subtitle}</p>}</div>
      <button type="button" className="icon-button" onClick={close} aria-label={t('close')} disabled={busy}><X size={20} /></button>
    </header>
    <div className="sheet-body">{error && <p className="editor-error" role="alert">{error}</p>}{children}</div>
    {footer && <footer className="sheet-footer">{footer}</footer>}
  </dialog>;
}

function InlineError({ failed, t }: { failed: boolean; t: Translate }) {
  return failed ? <p className="editor-error" role="alert">{t('saveError')}</p> : null;
}

function activityAction(action: string, t: Translate) {
  const key = action.toLowerCase();
  if (key.includes('creat')) return t('created');
  if (key.includes('updat')) return t('updated');
  if (key.includes('archiv')) return t('archived');
  if (key.includes('restor')) return t('restoredSuccess');
  return action;
}

function displayValue(value: string, field: string, t: Translate) {
  if (!value) return t('empty');
  if (field === 'status' && statuses.includes(value as Status)) return t(value as Status);
  if (field === 'priority' && priorities.includes(value as Priority)) return t(value as Priority);
  if (value === 'Unassigned') return t('unassigned');
  return value;
}

function MiniHistory({ activity, title, lang, t }: { activity: Activity[]; title: string; lang: Language; t: Translate }) {
  const fields: Record<string, MessageKey> = {
    title: 'title', description: 'description', status: 'status', priority: 'priority', assigneeId: 'assignee',
    assignee: 'assignee', dueDate: 'dueDate', date: 'date', time: 'time', attendeeIds: 'attendees', attendees: 'attendees',
    agenda: 'agenda', minutes: 'minutes', decisions: 'decisions', actionItems: 'actionItems', name: 'name', role: 'role', archived: 'archived', meetingIds: 'linkedMeetings',
  };
  return <section className="form-section mini-history" aria-label={title}>
    <h3 className="section-label"><History size={16} /> {title}</h3>
    {[...activity].sort((a, b) => b.at.localeCompare(a.at)).map(event => <article className="history-row" key={event.id}>
      <div className="history-row-heading"><strong>{activityAction(event.action, t)}</strong><time dateTime={event.at}>{dateTime(event.at, lang)}</time></div>
      <p className="muted small">{t('by')} <bdi>{event.actor}</bdi></p>
      {event.changes.length > 0 && <details className="history-details"><summary>{t('changeDetails')}</summary>
        {event.changes.map((change, index) => <div className="history-change" key={`${change.field}-${index}`}>
          <strong>{fields[change.field] ? t(fields[change.field]) : change.field}</strong>
          <div><span className="muted">{t('before')}: </span><span dir="auto">{displayValue(change.from, change.field, t)}</span></div>
          <div><span className="muted">{t('after')}: </span><span dir="auto">{displayValue(change.to, change.field, t)}</span></div>
        </div>)}
      </details>}
    </article>)}
  </section>;
}

function useMutation(mutate: Mutate) {
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function perform(type: OperationType, payload: Record<string, unknown>, expectedUpdatedAt?: string) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    setFailed(false);
    try {
      const success = await mutate(type, payload, expectedUpdatedAt);
      setFailed(!success);
      return success;
    } catch {
      setFailed(true);
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { pending, failed, perform };
}

export function TaskEditor({ task: taskProp, initialStatus, initialMeetingIds = [], workspace, t, lang, busy, mutate, onClose, error }: CommonProps & { task: Task | null; initialStatus: Status; initialMeetingIds?: string[] }) {
  const [task] = useState(taskProp);
  const [initial] = useState(() => ({
    title: task?.title ?? '', description: task?.description ?? '', status: task?.status ?? initialStatus,
    priority: task?.priority ?? 'medium' as Priority, assigneeId: task?.assigneeId ?? '', dueDate: task?.dueDate ?? '',
    meetingIds: task?.meetingIds ?? initialMeetingIds,
  }));
  const [draft, setDraft] = useState(initial);
  const { pending, failed, perform } = useMutation(mutate);
  const locked = busy || pending;
  const archived = task?.archived ?? false;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const formId = useId();
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || archived) return;
    const payload = { ...draft, title: draft.title.trim(), assigneeId: draft.assigneeId || null, ...(task ? { id: task.id } : {}) };
    if (await perform(task ? 'task.update' : 'task.create', payload, task?.updatedAt)) onClose();
  }
  async function archiveOrRestore() {
    if (!task || locked) return;
    if (!archived && dirty && !window.confirm(t('discard'))) return;
    if (!archived && !window.confirm(t('archiveConfirm'))) return;
    if (await perform(archived ? 'task.restore' : 'task.archive', { id: task.id }, task.updatedAt)) onClose();
  }
  const availablePeople = workspace.people.filter(person => !person.archived || person.id === draft.assigneeId);
  const availableMeetings = workspace.meetings.filter(meeting => !meeting.archived || task?.meetingIds.includes(meeting.id)).sort((a, b) => b.date.localeCompare(a.date));
  return <Sheet title={task ? t('taskDetails') : t('newTask')} dirty={dirty} busy={locked} onClose={onClose} t={t} lang={lang} error={error}
    subtitle={archived ? t('archived') : undefined}
    footer={<>
      {task && <button className={`button ${archived ? 'secondary' : 'ghost'}`} type="button" disabled={locked} onClick={archiveOrRestore}>
        {archived ? <RotateCcw size={16} /> : <Archive size={16} />}{t(archived ? 'restore' : 'archive')}
      </button>}
      {!archived && <button className="button primary" form={formId} type="submit" disabled={locked || !draft.title.trim()}>
        {locked ? t('saving') : t(task ? 'save' : 'create')}<Check size={16} />
      </button>}
    </>}>
    <form id={formId} onSubmit={save}>
      <fieldset disabled={locked || archived} className="editor-fieldset">
        <label className="field"><span>{t('title')} <span aria-hidden="true">*</span></span><input className="input title-input" autoFocus required maxLength={200} value={draft.title} dir="auto" placeholder={t('taskPlaceholder')} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="field"><span>{t('description')}</span><textarea className="textarea" rows={4} maxLength={12000} value={draft.description} dir="auto" placeholder={t('descriptionPlaceholder')} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <div className="field-row">
          <label className="field"><span>{t('status')}</span><select className="select" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Status })}>{statuses.map(status => <option key={status} value={status}>{t(status)}</option>)}</select></label>
          <label className="field"><span>{t('priority')}</span><select className="select" value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as Priority })}>{priorities.map(priority => <option key={priority} value={priority}>{t(priority)}</option>)}</select></label>
        </div>
        <div className="field-row">
          <label className="field"><span>{t('assignee')}</span><select className="select" value={draft.assigneeId} onChange={event => setDraft({ ...draft, assigneeId: event.target.value })}><option value="">{t('unassigned')}</option>{availablePeople.map(person => <option key={person.id} value={person.id}>{person.name}{person.archived ? ` (${t('archivedPerson')})` : ''}</option>)}</select></label>
          <label className="field"><span>{t('dueDate')}</span><input className="input" type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        </div>
        {!availablePeople.length && <p className="muted small">{t('createTeamFirst')}</p>}
        <fieldset className="meeting-selection">
          <legend>{t('linkedMeetings')}</legend>
          <p className="field-hint">{t('meetingLinksHint')}</p>
          <div className="meeting-selection-list">{availableMeetings.map(meeting => <label className="meeting-selection-option" key={meeting.id}>
            <input type="checkbox" checked={draft.meetingIds.includes(meeting.id)} onChange={event => setDraft({ ...draft, meetingIds: event.target.checked ? [...draft.meetingIds, meeting.id] : draft.meetingIds.filter(id => id !== meeting.id) })} />
            <span><bdi>{meeting.title}</bdi><span className="meeting-option-date">{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en-GB', { dateStyle: 'medium' }).format(new Date(`${meeting.date}T12:00:00`))}{meeting.archived ? ` · ${t('archived')}` : ''}</span></span>
          </label>)}</div>
          {!availableMeetings.length && <p className="muted">{t('noMeetingOptions')}</p>}
        </fieldset>
      </fieldset>
      <InlineError failed={failed && !error} t={t} />
    </form>
    {task && <MiniHistory activity={workspace.activity.filter(event => event.entityType === 'task' && event.entityId === task.id)} title={t('taskHistory')} lang={lang} t={t} />}
  </Sheet>;
}

export function MeetingEditor({ meeting: meetingProp, workspace, t, lang, busy, mutate, onClose, error, onViewTasks }: CommonProps & { meeting: Meeting | null; onViewTasks?: (meetingId: string) => void }) {
  const [meeting] = useState(meetingProp);
  const [initial] = useState(() => ({
    title: meeting?.title ?? '', date: meeting?.date ?? localDate(), time: meeting?.time ?? '',
    attendeeIds: meeting?.attendeeIds ?? [], agenda: meeting?.agenda ?? '', minutes: meeting?.minutes ?? '',
    decisions: meeting?.decisions ?? '', actionItems: meeting?.actionItems ?? '',
  }));
  const [draft, setDraft] = useState(initial);
  const { pending, failed, perform } = useMutation(mutate);
  const locked = busy || pending;
  const archived = meeting?.archived ?? false;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const formId = useId();
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || archived) return;
    if (await perform(meeting ? 'meeting.update' : 'meeting.create', { ...draft, title: draft.title.trim(), ...(meeting ? { id: meeting.id } : {}) }, meeting?.updatedAt)) onClose();
  }
  async function archiveOrRestore() {
    if (!meeting || locked) return;
    if (!archived && dirty && !window.confirm(t('discard'))) return;
    if (!archived && !window.confirm(t('archiveConfirm'))) return;
    if (await perform(archived ? 'meeting.restore' : 'meeting.archive', { id: meeting.id }, meeting.updatedAt)) onClose();
  }
  function downloadMinutes() {
    const attendees = draft.attendeeIds.map(id => workspace.people.find(person => person.id === id)?.name).filter(Boolean).join(', ');
    const text = [
      'Team Desk', draft.title, `${t('date')}: ${draft.date}${draft.time ? ` · ${draft.time}` : ''}`,
      `${t('attendees')}: ${attendees || t('noAttendees')}`, '',
      t('agenda'), draft.agenda, '', t('minutes'), draft.minutes || t('noMinutes'), '',
      t('decisions'), draft.decisions, '', t('actionItems'), draft.actionItems,
    ].join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Team Desk-${draft.date}-${draft.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'meeting'}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const people = workspace.people.filter(person => !person.archived || draft.attendeeIds.includes(person.id));
  const noteFields: Array<{ key: 'agenda' | 'minutes' | 'decisions' | 'actionItems'; placeholder: MessageKey; rows: number }> = [
    { key: 'agenda', placeholder: 'agendaPlaceholder', rows: 3 },
    { key: 'minutes', placeholder: 'minutesPlaceholder', rows: 9 },
    { key: 'decisions', placeholder: 'decisionsPlaceholder', rows: 4 },
    { key: 'actionItems', placeholder: 'actionsPlaceholder', rows: 4 },
  ];
  return <Sheet title={meeting ? t('meetingDetails') : t('newMeeting')} subtitle={archived ? t('archived') : undefined} dirty={dirty} busy={locked} onClose={onClose} t={t} lang={lang} error={error}
    footer={<>
      {meeting && <button type="button" className={`button ${archived ? 'secondary' : 'ghost'}`} disabled={locked} onClick={archiveOrRestore}>{archived ? <RotateCcw size={16} /> : <Archive size={16} />}{t(archived ? 'restore' : 'archive')}</button>}
      {!archived && <button type="submit" className="button primary" form={formId} disabled={locked || !draft.title.trim() || !draft.date}>{locked ? t('saving') : t(meeting ? 'save' : 'createMeeting')}<Check size={16} /></button>}
    </>}>
    {meeting && onViewTasks && <div className="meeting-editor-actions"><button type="button" className="button secondary" disabled={locked} onClick={() => { if (!dirty || window.confirm(t('discard'))) onViewTasks(meeting.id); }}><LayoutGrid size={17} />{t('viewTasks')}<span className="count">{workspace.tasks.filter(task => !task.archived && task.meetingIds.includes(meeting.id)).length}</span></button></div>}
    <form id={formId} onSubmit={save}>
      <fieldset className="editor-fieldset" disabled={locked || archived}>
        <label className="field"><span>{t('title')} <span aria-hidden="true">*</span></span><input className="input title-input" dir="auto" autoFocus value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} required maxLength={200} placeholder={t('meetingPlaceholder')} /></label>
        <div className="field-row">
          <label className="field"><span>{t('date')} <span aria-hidden="true">*</span></span><input className="input" type="date" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>
          <label className="field"><span>{t('time')} <span className="muted">({t('optional')})</span></span><input className="input" type="time" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} /></label>
        </div>
        <div className="field"><span id={`${formId}-attendees`}>{t('attendees')}</span><div className="attendee-list" role="group" aria-labelledby={`${formId}-attendees`}>
          {people.map(person => <button key={person.id} type="button" className={`attendee-toggle${draft.attendeeIds.includes(person.id) ? ' selected' : ''}`} aria-pressed={draft.attendeeIds.includes(person.id)} onClick={() => setDraft({ ...draft, attendeeIds: draft.attendeeIds.includes(person.id) ? draft.attendeeIds.filter(id => id !== person.id) : [...draft.attendeeIds, person.id] })}>
            {draft.attendeeIds.includes(person.id) && <Check size={14} />}<bdi>{person.name}</bdi>{person.archived && <span className="muted small">({t('archivedPerson')})</span>}
          </button>)}
          {!people.length && <p className="muted small">{t('createTeamFirst')}</p>}
        </div></div>
        {noteFields.map(field => <label key={field.key} className={`field ${field.key === 'minutes' ? 'minutes-field' : ''}`}><span>{t(field.key)}{field.key === 'minutes' && lang === 'en' && <span className="muted" lang="ar"> · محضر الاجتماع</span>}</span><textarea className="textarea" dir="auto" rows={field.rows} maxLength={30000} value={draft[field.key]} placeholder={t(field.placeholder)} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} /></label>)}
      </fieldset>
      <InlineError failed={failed && !error} t={t} />
    </form>
    <button type="button" className="button secondary" onClick={downloadMinutes} disabled={!draft.title.trim()}><Download size={16} />{t('downloadMinutes')}</button>
    {meeting && <MiniHistory activity={workspace.activity.filter(event => event.entityType === 'meeting' && event.entityId === meeting.id)} title={t('meetingHistory')} lang={lang} t={t} />}
  </Sheet>;
}

export function TeamEditor({ workspace, t, lang, busy, mutate, onClose, error }: CommonProps) {
  const [editing, setEditing] = useState<Person | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { pending, failed, perform } = useMutation(mutate);
  const nameRef = useRef<HTMLInputElement>(null);
  const locked = busy || pending;
  const dirty = name !== (editing?.name ?? '') || role !== (editing?.role ?? '');
  function reset() { setEditing(null); setName(''); setRole(''); }
  function edit(person: Person) {
    if (dirty && !window.confirm(t('discard'))) return;
    setEditing(person); setName(person.name); setRole(person.role);
    nameRef.current?.focus();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || !name.trim()) return;
    const payload = { name: name.trim(), role: role.trim(), ...(editing ? { id: editing.id } : {}) };
    if (await perform(editing ? 'person.update' : 'person.create', payload, editing?.updatedAt)) reset();
  }
  async function archiveOrRestore(person: Person) {
    if (locked) return;
    if (!person.archived && !window.confirm(t('personArchiveConfirm'))) return;
    if (person.id === editing?.id && dirty && !window.confirm(t('discard'))) return;
    if (await perform(person.archived ? 'person.restore' : 'person.archive', { id: person.id }, person.updatedAt)) {
      if (editing?.id === person.id) reset();
    }
  }
  const people = workspace.people.filter(person => person.archived === showArchived);
  return <Sheet title={t('members')} dirty={dirty} busy={locked} onClose={onClose} t={t} lang={lang} error={error}>
    <form className="form-section member-form" onSubmit={save}>
      <fieldset className="editor-fieldset" disabled={locked}>
        <div className="field-row">
          <label className="field"><span>{t('name')} <span aria-hidden="true">*</span></span><input ref={nameRef} className="input" dir="auto" autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder={t('namePlaceholder')} /></label>
          <label className="field"><span>{t('role')}</span><input className="input" dir="auto" maxLength={100} value={role} onChange={event => setRole(event.target.value)} placeholder={t('rolePlaceholder')} /></label>
        </div>
        <div className="member-form-actions">
          {editing && <button className="button ghost" type="button" onClick={() => { if (!dirty || window.confirm(t('discard'))) reset(); }}>{t('cancel')}</button>}
          <button className="button primary" type="submit" disabled={locked || !name.trim()}>{editing ? <Check size={16} /> : <Plus size={16} />}{locked ? t('saving') : t(editing ? 'save' : 'addMember')}</button>
        </div>
      </fieldset>
      <InlineError failed={failed && !error} t={t} />
    </form>
    <section className="form-section">
      <div className="member-list-heading"><h3 className="section-label"><Users size={16} />{t(showArchived ? 'archivedItems' : 'members')} <span className="badge">{people.length}</span></h3>
        <button className="button ghost" type="button" onClick={() => setShowArchived(!showArchived)}>{t(showArchived ? 'active' : 'archived')}</button></div>
      <div className="member-list">
        {people.map(person => <div className="member-row" key={person.id}>
          <span className="avatar" aria-hidden="true">{initials(person.name)}</span>
          <div className="member-details"><strong dir="auto">{person.name}</strong>{person.role && <span className="muted small" dir="auto">{person.role}</span>}</div>
          <div className="member-actions">
            {!person.archived && <button className="icon-button" type="button" disabled={locked} onClick={() => edit(person)} aria-label={`${t('edit')} ${person.name}`} title={t('edit')}><Pencil size={16} /></button>}
            <button className="icon-button" type="button" disabled={locked} onClick={() => archiveOrRestore(person)} aria-label={`${t(person.archived ? 'restore' : 'archive')} ${person.name}`} title={t(person.archived ? 'restore' : 'archive')}>{person.archived ? <RotateCcw size={16} /> : <Archive size={16} />}</button>
          </div>
        </div>)}
        {!people.length && <p className="empty-inline muted">{t(showArchived ? 'noArchive' : 'noMembers')}</p>}
      </div>
    </section>
  </Sheet>;
}
