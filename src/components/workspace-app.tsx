'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronDown, Clock3, FileText, History, LayoutGrid, LoaderCircle, Plus, RefreshCw, Search, Users, X, AlertCircle, Circle, CircleDashed, CircleCheck, ArrowRight } from 'lucide-react';
import type { Activity, Meeting, Person, Priority, Status, Task, Workspace } from '@/lib/types';
import { messages, type Language, type MessageKey, type Translate } from '@/lib/i18n';
import { TaskEditor, MeetingEditor, TeamEditor, type Mutate } from './editors';
import { CarryDialog } from './carry-dialog';

type Tab = 'tasks' | 'meetings' | 'history';
type Editor = { kind: 'task'; item: Task | null; status: Status; meetingIds: string[] } | { kind: 'meeting'; item: Meeting | null } | { kind: 'team' } | null;
const statuses: Status[] = ['todo', 'progress', 'review', 'done'];
const priorities: Priority[] = ['low', 'medium', 'high'];
const statusIcons = { todo: CircleDashed, progress: Circle, review: CircleCheck, done: CheckCheck };

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(w => Array.from(w)[0]).join('').toLocaleUpperCase(); }
function dateLabel(value: string, lang: Language, withYear = false) {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}
function localToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function Avatar({ person, small = false }: { person?: Person; small?: boolean }) {
  const color = person ? Array.from(person.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 5 : 0;
  return <span className={`avatar avatar-${color}${small ? ' avatar-small' : ''}`} aria-hidden="true">{person ? initials(person.name) : <Users size={13} />}</span>;
}
function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Empty({ title, text, icon: Icon, action }: { title: string; text: string; icon: typeof FileText; action?: React.ReactNode }) {
  return <div className="empty-state"><Icon size={28} strokeWidth={1.5} /><h2>{title}</h2><p>{text}</p>{action}</div>;
}
function readableChange(value: string, t: Translate) {
  return ['todo','progress','review','done','low','medium','high','unassigned'].includes(value) ? t(value as MessageKey) : value;
}
function activityAction(action: string, lang: Language) {
  const verb = action.split('.').at(-1) || action;
  const text: Record<string, [string, string]> = { create: ['created', 'أنشأ'], created: ['created', 'أنشأ'], update: ['updated', 'حدّث'], updated: ['updated', 'حدّث'], archive: ['archived', 'أرشف'], archived: ['archived', 'أرشف'], restore: ['restored', 'استعاد'], restored: ['restored', 'استعاد'] };
  return text[verb]?.[lang === 'ar' ? 1 : 0] || action;
}

export default function WorkspaceApp() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [lang, setLang] = useState<Language>('en');
  const [tab, setTab] = useState<Tab>('tasks');
  const [editor, setEditor] = useState<Editor>(null);
  const [query, setQuery] = useState('');
  const [personFilter, setPersonFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [meetingScope, setMeetingScope] = useState('');
  const [carrySourceId, setCarrySourceId] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [actorId, setActorId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Status | null>(null);
  const lastLoaded = useRef(0);
  const busyRef = useRef(false);
  const bulkRunning = useRef(false);
  const requestGeneration = useRef(0);
  const retryOperation = useRef<{ signature: string; id: string } | null>(null);
  const localeRef = useRef(lang); localeRef.current = lang;
  const t: Translate = (key) => messages[lang][key];

  const refresh = useCallback(async () => {
    if (busyRef.current || bulkRunning.current) return;
    const generation = ++requestGeneration.current;
    setRefreshing(true);
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || messages[localeRef.current].loadError);
      if (generation !== requestGeneration.current) return;
      setWorkspace(data.state); setError(''); lastLoaded.current = Date.now();
    } catch (err) {
      if (generation === requestGeneration.current) setError(err instanceof Error ? err.message : messages[localeRef.current].loadError);
    } finally { if (generation === requestGeneration.current) setRefreshing(false); }
  }, []);

  useEffect(() => {
    try { const saved = localStorage.getItem('team-desk-language'); if (saved === 'ar' || saved === 'en') setLang(saved); setActorId(localStorage.getItem('team-desk-actor') || ''); setMeetingScope(localStorage.getItem('team-desk-meeting-scope') || ''); } catch { /* Preferences are optional. */ }
    void refresh();
    const onFocus = () => { if (Date.now() - lastLoaded.current > 60_000 && !busyRef.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }, [lang]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!workspace) return;
    const valid = meetingScope === 'all' || meetingScope === 'unlinked' || workspace.meetings.some(meeting => meeting.id === meetingScope);
    const next = valid ? meetingScope : [...workspace.meetings].filter(meeting => !meeting.archived).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))[0]?.id || 'all';
    if (next !== meetingScope) setMeetingScope(next);
    try { localStorage.setItem('team-desk-meeting-scope', next); } catch { /* Preferences are optional. */ }
  }, [workspace, meetingScope]);

  const mutate: Mutate = async (type, payload, expectedUpdatedAt) => {
    if (busyRef.current) return false;
    busyRef.current = true; ++requestGeneration.current; setRefreshing(false); setBusy(true); setError('');
    try {
      const actor = workspace?.people.find(p => p.id === actorId && !p.archived)?.name || 'Team member';
      const signature = JSON.stringify({ type, payload, actor, expectedUpdatedAt });
      if (retryOperation.current?.signature !== signature) retryOperation.current = { signature, id: crypto.randomUUID() };
      const response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: retryOperation.current.id, type, payload, actor, expectedUpdatedAt }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) retryOperation.current = null;
        if (response.status === 409) {
          try {
            const freshResponse = await fetch('/api/workspace', { cache: 'no-store' });
            if (freshResponse.ok) { const fresh = await freshResponse.json(); setWorkspace(fresh.state); lastLoaded.current = Date.now(); }
          } catch { /* Keep the draft and report the original conflict. */ }
        }
        throw new Error(response.status === 409 ? t('conflict') : data.error || t('saveError'));
      }
      retryOperation.current = null;
      setWorkspace(data.state); lastLoaded.current = Date.now();
      if (!bulkRunning.current) setNotice(t(type.endsWith('.archive') ? 'archivedSuccess' : type.endsWith('.restore') ? 'restoredSuccess' : type === 'task.create' ? 'taskCreated' : type === 'meeting.create' ? 'meetingCreated' : type === 'person.create' ? 'memberAdded' : 'saved'));
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : t('saveError')); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  function changeTab(next: Tab) { setTab(next); setQuery(''); setArchived(false); setPersonFilter('all'); setPriorityFilter('all'); setActivityFilter('all'); }
  function toggleLanguage() { const next = lang === 'en' ? 'ar' : 'en'; setLang(next); try { localStorage.setItem('team-desk-language', next); } catch {} }
  function chooseActor(id: string) { setActorId(id); try { localStorage.setItem('team-desk-actor', id); } catch {} }
  function openTask(task: Task | null, status: Status = 'todo') { setError(''); setEditor({ kind: 'task', item: task, status, meetingIds: workspace?.meetings.some(meeting => meeting.id === meetingScope && !meeting.archived) ? [meetingScope] : [] }); }
  function openMeeting(meeting: Meeting | null) { setError(''); setEditor({ kind: 'meeting', item: meeting }); }
  function clearFilters() { setQuery(''); setPersonFilter('all'); setPriorityFilter('all'); setActivityFilter('all'); }
  function viewMeetingTasks(meetingId: string) { setMeetingScope(meetingId); changeTab('tasks'); setEditor(null); setError(''); }

  const people = workspace?.people.filter(p => !p.archived) || [];
  const sortedMeetings = [...(workspace?.meetings || [])].sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const selectedMeeting = workspace?.meetings.find(meeting => meeting.id === meetingScope);
  const carrySource = workspace?.meetings.find(meeting => meeting.id === carrySourceId);
  const canCarry = selectedMeeting && !selectedMeeting.archived && !archived && workspace?.tasks.some(task => !task.archived && task.status !== 'done' && task.meetingIds.includes(selectedMeeting.id));
  const term = query.trim().toLocaleLowerCase();
  const hasFilters = Boolean(term || personFilter !== 'all' || priorityFilter !== 'all' || activityFilter !== 'all');
  const tasks = (workspace?.tasks || []).filter(task => (meetingScope === 'all' || (meetingScope === 'unlinked' ? !task.meetingIds.length : task.meetingIds.includes(meetingScope))) && task.archived === archived && (personFilter === 'all' || (task.assigneeId || 'unassigned') === personFilter) && (priorityFilter === 'all' || task.priority === priorityFilter) && `${task.title} ${task.description} ${workspace?.people.find(p => p.id === task.assigneeId)?.name || ''}`.toLocaleLowerCase().includes(term));
  const meetings = (workspace?.meetings || []).filter(meeting => meeting.archived === archived && `${meeting.title} ${meeting.agenda} ${meeting.minutes} ${meeting.decisions} ${meeting.actionItems}`.toLocaleLowerCase().includes(term)).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const activity = (workspace?.activity || []).filter(item => (activityFilter === 'all' || item.entityType === activityFilter) && `${item.entityTitle} ${item.actor} ${item.action} ${item.changes.map(c => `${c.from} ${c.to}`).join(' ')}`.toLocaleLowerCase().includes(term)).sort((a, b) => b.at.localeCompare(a.at));

  const newButton = <button className="button primary" disabled={!workspace || busy} onClick={() => tab === 'meetings' ? openMeeting(null) : openTask(null)}><Plus size={17} />{t(tab === 'meetings' ? 'newMeeting' : 'newTask')}</button>;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Team Desk">Team Desk</a>
      <div className="topbar-actions">
        <button className="language-button" onClick={toggleLanguage} lang={lang === 'en' ? 'ar' : 'en'}>{lang === 'en' ? 'العربية' : 'English'}</button>
        <span className="topbar-divider" />
        <button className="team-button" onClick={() => { setError(''); setEditor({ kind: 'team' }); }} disabled={!workspace}><Users size={17} /><span>{t('team')}</span><span className="count">{people.length}</span></button>
      </div>
    </header>

    <div className="nav-row"><nav className="tabs" aria-label={t('workspace')}>
      {([{ id: 'tasks', icon: LayoutGrid }, { id: 'meetings', icon: CalendarDays }, { id: 'history', icon: History }] as const).map(({ id, icon: Icon }) => <button key={id} onClick={() => changeTab(id)} className={`tab ${tab === id ? 'selected' : ''}`} aria-current={tab === id ? 'page' : undefined}><Icon size={17} />{t(id)}</button>)}
    </nav></div>

    <main className="main-content">
      <section className="page-heading">
        <h1>{t(tab)}</h1>
        <div className="heading-actions">{tab !== 'history' ? newButton : <button className="button secondary" disabled={!workspace} title={t('exportHint')} onClick={() => workspace && download(`Team Desk-workspace-${localToday()}.json`, JSON.stringify(workspace, null, 2))}><ArrowDownToLine size={17} />{t('export')}</button>}</div>
      </section>

      {error && <div className={`error-banner ${editor ? 'over-sheet' : ''}`} role="alert"><AlertCircle size={19} /><span>{error}</span>{!workspace && <button onClick={() => void refresh()}>{t('retry')}</button>}<button className="icon-button" aria-label={t('close')} onClick={() => setError('')}><X size={16} /></button></div>}

      {tab === 'tasks' && workspace && <div className="meeting-scope"><label className="meeting-scope-select"><span><CalendarDays size={18} />{t('meeting')}</span><select className="select" value={meetingScope} onChange={event => setMeetingScope(event.target.value)}><option value="all">{t('allMeetings')}</option><option value="unlinked">{t('noMeeting')}</option>{sortedMeetings.map(meeting => <option key={meeting.id} value={meeting.id}>{dateLabel(meeting.date, lang, true)} · {meeting.title}{meeting.archived ? ` (${t('archived')})` : ''}</option>)}</select></label>{canCarry && <button className="button secondary" disabled={busy} onClick={() => { setError(''); setNotice(''); setCarrySourceId(selectedMeeting.id); }}><ArrowRight size={17} />{t('carryTasks')}</button>}</div>}

      <div className="toolbar">
        <div className="search-box"><Search size={17} /><input aria-label={t('search')} placeholder={t(tab === 'tasks' ? 'searchTasks' : tab === 'meetings' ? 'searchMeetings' : 'searchHistory')} value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label={t('clear')} onClick={() => setQuery('')}><X size={14} /></button>}</div>
        <div className="toolbar-filters">{tab === 'tasks' && <><label className="filter-select"><Users size={15} /><select aria-label={t('assignee')} value={personFilter} onChange={event => setPersonFilter(event.target.value)}><option value="all">{t('allPeople')}</option><option value="unassigned">{t('unassigned')}</option>{workspace?.people.map(person => <option key={person.id} value={person.id}>{person.name}{person.archived ? ` (${t('archived')})` : ''}</option>)}</select><ChevronDown size={13} /></label><label className="filter-select priority-filter"><select aria-label={t('priority')} value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}><option value="all">{t('allPriorities')}</option>{priorities.map(priority => <option key={priority} value={priority}>{t(priority)}</option>)}</select><ChevronDown size={13} /></label></>}
        {tab === 'history' && <label className="filter-select"><select aria-label={t('changes')} value={activityFilter} onChange={event => setActivityFilter(event.target.value)}><option value="all">{t('allChanges')}</option><option value="task">{t('tasks')}</option><option value="meeting">{t('meetings')}</option><option value="person">{t('team')}</option></select><ChevronDown size={13} /></label>}
        {hasFilters && <button className="text-button clear-filters" onClick={clearFilters}>{t('clear')}</button>}
        </div><div className="toolbar-end">
          {tab !== 'history' && <button className={`archive-toggle ${archived ? 'selected' : ''}`} aria-pressed={archived} title={t('archiveLabel')} onClick={() => setArchived(!archived)}><Archive size={15} /><span>{t('archived')}</span></button>}
          <button className="icon-button refresh-button" title={t('refresh')} aria-label={t('refresh')} disabled={refreshing || busy} onClick={() => void refresh()}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
        </div>
      </div>

      {!workspace ? <div className="loading-state" role="status">{!error && <LoaderCircle className="spin" size={24} />}<p>{error ? t('loadError') : t('loading')}</p>{error && <button className="button secondary" onClick={() => void refresh()}>{t('retry')}</button>}</div> : <>
      {tab === 'tasks' && <>
        {archived ? <div className="archive-grid">{tasks.length ? tasks.map(task => <TaskCard key={task.id} task={task} people={workspace.people} meetings={workspace.meetings} lang={lang} t={t} onOpen={() => openTask(task)} />) : <Empty title={t(hasFilters ? 'noMatches' : 'noArchive')} text={t(hasFilters ? 'noMatchesBody' : 'noArchiveBody')} icon={Archive} />}</div> : <>
          {hasFilters && !tasks.length ? <Empty title={t('noMatches')} text={t('noMatchesBody')} icon={Search} action={<button className="button secondary" onClick={clearFilters}>{t('clear')}</button>} /> : <div className="kanban">{statuses.map(status => {
            const columnTasks = tasks.filter(task => task.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); const Icon = statusIcons[status];
            return <section key={status} aria-label={t(status)} className={`kanban-column column-${status} ${dragOver === status ? 'drag-over' : ''}`} onDragOver={event => { if (!dragging || busy) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(status); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }} onDrop={event => { event.preventDefault(); setDragOver(null); setDragging(null); const task = workspace.tasks.find(item => item.id === event.dataTransfer.getData('text/plain')); if (task && !busy && task.status !== status) void mutate('task.update', { id: task.id, status }, task.updatedAt); }}>
              <div className="column-heading"><span className="status-symbol"><Icon size={17} /></span><h2>{t(status)}</h2><span className="column-count">{columnTasks.length}</span><button className="icon-button" title={`${t('addTask')} — ${t(status)}`} aria-label={`${t('addTask')} — ${t(status)}`} onClick={() => openTask(null, status)}><Plus size={17} /></button></div>
              <div className="column-cards">{columnTasks.map(task => <TaskCard key={task.id} task={task} people={workspace.people} meetings={workspace.meetings} lang={lang} t={t} onOpen={() => openTask(task)} draggable={!busy} onDragStart={event => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setDragging(task.id); }} onDragEnd={() => { setDragging(null); setDragOver(null); }} />)}
                {!columnTasks.length && <button className="empty-column" onClick={() => openTask(null, status)}><Plus size={17} />{t('addTask')}</button>}
              </div>{columnTasks.length > 0 && <button className="column-add" onClick={() => openTask(null, status)}><Plus size={14} />{t('addTask')}</button>}
            </section>;
          })}</div>}
        </>}
      </>}
      {tab === 'meetings' && <div className="meetings-list">{!meetings.length ? <Empty title={t(hasFilters ? 'noMatches' : archived ? 'noArchive' : 'noMeetings')} text={t(hasFilters ? 'noMatchesBody' : archived ? 'noArchiveBody' : 'noMeetingsBody')} icon={CalendarDays} action={!hasFilters && !archived ? <button className="button secondary" onClick={() => openMeeting(null)}><Plus size={16} />{t('addMeeting')}</button> : undefined} /> : <>
        {meetings.map(meeting => { const date = new Date(`${meeting.date}T12:00:00`); const taskCount = workspace.tasks.filter(task => !task.archived && task.meetingIds.includes(meeting.id)).length; return <article className="meeting-row" key={meeting.id}>
          <button type="button" className="meeting-row-main" onClick={() => openMeeting(meeting)}>
            <span className="meeting-date"><span>{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en', { month: 'short' }).format(date)}</span><b>{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en', { day: '2-digit' }).format(date)}</b></span>
            <span className="meeting-info"><h2 dir="auto">{meeting.title}</h2><span className="meeting-meta"><span>{dateLabel(meeting.date, lang, true)}</span>{meeting.time && <span><Clock3 size={14} /><bdi>{meeting.time}</bdi></span>}</span></span>
            <span className={`minutes-status ${meeting.minutes.trim() ? 'ready' : ''}`}><FileText size={16} />{t(meeting.minutes.trim() ? 'minutesReady' : 'minutesPending')}</span>
          </button>
          <div className="meeting-row-actions"><button type="button" className="button secondary" aria-label={`${t('viewTasks')} — ${meeting.title} (${taskCount})`} onClick={() => viewMeetingTasks(meeting.id)}><LayoutGrid size={17} />{t('viewTasks')}<span className="count">{taskCount}</span></button></div>
        </article>; })}
      </>}</div>}
      {tab === 'history' && <div className="activity-list">{!activity.length ? <Empty title={t(hasFilters ? 'noMatches' : 'noHistory')} text={t(hasFilters ? 'noMatchesBody' : 'noHistoryBody')} icon={History} /> : activity.map(item => <ActivityRow key={item.id} item={item} lang={lang} t={t} onOpen={() => { if (item.entityType === 'task') { const found = workspace.tasks.find(task => task.id === item.entityId); if (found) openTask(found); } else if (item.entityType === 'meeting') { const found = workspace.meetings.find(meeting => meeting.id === item.entityId); if (found) openMeeting(found); } else setEditor({ kind: 'team' }); }} />)}</div>}
      </>}
    </main>

    <footer className="workspace-footer" title={t('sharedHint')}><label className="actor-select" title={t('nameHint')}><span>{t('workingAs')}</span><select aria-label={t('workingAs')} value={people.some(p => p.id === actorId) ? actorId : ''} onChange={event => chooseActor(event.target.value)}><option value="">{t('teamMember')}</option>{people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select><ChevronDown size={14} /></label></footer>

    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {editor && workspace && <div className="editor-host">{editor.kind === 'task' ? <TaskEditor error={error} workspace={workspace} task={editor.item} initialStatus={editor.status} initialMeetingIds={editor.meetingIds} t={t} lang={lang} busy={busy} mutate={mutate} onClose={() => { setEditor(null); setError(''); }} /> : editor.kind === 'meeting' ? <MeetingEditor error={error} workspace={workspace} meeting={editor.item} t={t} lang={lang} busy={busy} mutate={mutate} onViewTasks={viewMeetingTasks} onClose={() => { setEditor(null); setError(''); }} /> : <TeamEditor error={error} workspace={workspace} t={t} lang={lang} busy={busy} mutate={mutate} onClose={() => { setEditor(null); setError(''); }} />}</div>}
    {carrySource && workspace && <CarryDialog source={carrySource} workspace={workspace} lang={lang} t={t} mutate={mutate} error={error} onClose={() => { setCarrySourceId(null); setError(''); }} onRunningChange={running => { bulkRunning.current = running; }} onComplete={count => { setCarrySourceId(null); setNotice(`${t('carryComplete')} (${count})`); }} />}
  </div>;
}

function TaskCard({ task, people, meetings, lang, t, onOpen, draggable = false, onDragStart, onDragEnd }: { task: Task; people: Person[]; meetings: Meeting[]; lang: Language; t: Translate; onOpen: () => void; draggable?: boolean; onDragStart?: React.DragEventHandler<HTMLButtonElement>; onDragEnd?: React.DragEventHandler<HTMLButtonElement> }) {
  const person = people.find(p => p.id === task.assigneeId);
  const overdue = task.dueDate && task.dueDate < localToday() && task.status !== 'done';
  const linkedMeetings = meetings.filter(meeting => task.meetingIds.includes(meeting.id)).sort((a, b) => b.date.localeCompare(a.date));
  return <button className={`task-card ${task.status === 'done' ? 'task-completed' : ''}`} onClick={onOpen} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <div className="task-card-top"><span className={`priority-tag priority-${task.priority}`}><span />{t(task.priority)}</span><span className="task-arrow"><ArrowUpRight size={15} /></span></div>
    <h3 dir="auto">{task.title}</h3>
    <div className="task-meetings" aria-label={t('linkedMeetings')}>{linkedMeetings.length ? <>{linkedMeetings.slice(0, 2).map(meeting => <span className="meeting-badge" key={meeting.id} title={`${meeting.title} · ${dateLabel(meeting.date, lang, true)}${meeting.archived ? ` · ${t('archived')}` : ''}`}><CalendarDays size={14} /><span aria-label={`${meeting.title}, ${dateLabel(meeting.date, lang, true)}`}>{dateLabel(meeting.date, lang)}</span></span>)}{linkedMeetings.length > 2 && <span className="meeting-badge" title={linkedMeetings.slice(2).map(meeting => `${meeting.title} · ${dateLabel(meeting.date, lang, true)}`).join('\n')} aria-label={linkedMeetings.slice(2).map(meeting => `${meeting.title}, ${dateLabel(meeting.date, lang, true)}`).join('; ')}>+{linkedMeetings.length - 2}</span>}</> : <span className="meeting-badge unlinked">{t('noMeeting')}</span>}</div>
    <div className="task-card-bottom"><span className="task-person"><Avatar person={person} small /><span dir="auto">{person?.name || t('unassigned')}</span></span>{task.dueDate && <span className={`task-date ${overdue ? 'overdue' : ''}`} title={overdue ? t('overdue') : t('dueDate')}><CalendarDays size={12} />{dateLabel(task.dueDate, lang)}</span>}</div>
  </button>;
}

function ActivityRow({ item, lang, t, onOpen }: { item: Activity; lang: Language; t: Translate; onOpen: () => void }) {
  const Icon = item.entityType === 'task' ? LayoutGrid : item.entityType === 'meeting' ? CalendarDays : Users;
  const fieldNames: Record<string, MessageKey> = { title: 'title', description: 'description', status: 'status', priority: 'priority', assigneeId: 'assignee', dueDate: 'dueDate', date: 'date', time: 'time', attendeeIds: 'attendees', agenda: 'agenda', minutes: 'minutes', decisions: 'decisions', actionItems: 'actionItems', name: 'name', role: 'role', archived: 'archived', meetingIds: 'linkedMeetings' };
  return <article className="activity-row"><span className={`activity-icon activity-${item.entityType}`}><Icon size={17} /></span><div className="activity-content"><div className="activity-main"><p><strong dir="auto">{item.actor === 'Team member' ? t('teamMember') : item.actor}</strong> {activityAction(item.action, lang)} <button className="activity-target" onClick={onOpen} dir="auto">{item.entityTitle}</button></p><time dateTime={item.at}>{new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(item.at))}</time></div>{item.changes.length > 0 && <details className="change-details"><summary>{t('changeDetails')} <span>{item.changes.length}</span></summary><div className="change-list">{item.changes.map((change, i) => <div className="change-item" key={`${change.field}-${i}`}><b>{fieldNames[change.field] ? t(fieldNames[change.field]) : change.field}</b><div><span className="change-from" dir="auto">{readableChange(change.from, t) || t('empty')}</span><ArrowRight size={13} /><span className="change-to" dir="auto">{readableChange(change.to, t) || t('empty')}</span></div></div>)}</div></details>}</div></article>;
}
