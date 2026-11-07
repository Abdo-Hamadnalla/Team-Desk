'use client';

import { useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type { Meeting, Workspace } from '@/lib/types';
import type { Language, Translate } from '@/lib/i18n';
import { Sheet, type Mutate } from './editors';

export function CarryDialog({ source, workspace, lang, t, mutate, error, onClose, onComplete, onRunningChange }: {
  source: Meeting; workspace: Workspace; lang: Language; t: Translate; mutate: Mutate; error?: string;
  onClose: () => void; onComplete: (count: number) => void; onRunningChange: (running: boolean) => void;
}) {
  const [destination, setDestination] = useState('');
  const [selected, setSelected] = useState(() => workspace.tasks.filter(task => !task.archived && task.status !== 'done' && task.meetingIds.includes(source.id)).map(task => task.id));
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const targets = workspace.meetings.filter(meeting => !meeting.archived && meeting.id !== source.id).sort((a, b) => b.date.localeCompare(a.date));
  const tasks = workspace.tasks.filter(task => !task.archived && task.status !== 'done' && task.meetingIds.includes(source.id));
  const available = tasks.filter(task => !task.meetingIds.includes(destination));
  const queue = available.filter(task => selected.includes(task.id));
  const destinationValid = targets.some(meeting => meeting.id === destination);
  const formatDate = (date: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SD' : 'en-GB', { dateStyle: 'medium' }).format(new Date(`${date}T12:00:00`));

  async function carry() {
    if (lock.current || !destinationValid || !queue.length) return;
    lock.current = true;
    setRunning(true);
    onRunningChange(true);
    setFailed(false);
    let saved = 0;
    try {
      for (const task of queue) {
        const success = await mutate('task.update', { id: task.id, meetingIds: [...new Set([...task.meetingIds, destination])] }, task.updatedAt);
        if (!success) {
          setFailed(true);
          return;
        }
        saved += 1;
        setCompleted(count => count + 1);
        setSelected(ids => ids.filter(id => id !== task.id));
      }
      onComplete(completed + saved);
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setRunning(false);
      onRunningChange(false);
    }
  }

  return <Sheet title={t('carryTasks')} dirty={running} busy={running} onClose={onClose} lang={lang} t={t} error={failed ? error || t('saveError') : undefined}
    footer={<><button className="button secondary" type="button" disabled={running} onClick={onClose}>{t('cancel')}</button><button className="button primary" type="button" disabled={running || !destinationValid || !queue.length} onClick={() => void carry()}>{running ? t('saving') : t('carrySelected')}{!running && <span className="count">{queue.length}</span>}<ArrowRight size={17} /></button></>}>
    <div className="carry-dialog">
      <p className="carry-source"><bdi>{source.title}</bdi> · {formatDate(source.date)}</p>
      <p className="field-hint">{t('carryKeepLinks')}</p>
      <label className="field"><span>{t('carryTo')}</span><select className="select" value={destination} disabled={running || !targets.length} onChange={event => { const next = event.target.value; setDestination(next); setSelected(tasks.filter(task => !task.meetingIds.includes(next)).map(task => task.id)); setCompleted(0); setFailed(false); }}><option value="">{t('chooseMeeting')}</option>{targets.map(meeting => <option key={meeting.id} value={meeting.id}>{formatDate(meeting.date)} · {meeting.title}</option>)}</select></label>
      {!targets.length && <p className="muted">{t('noCarryTargets')}</p>}
      {completed > 0 && <p className="carry-progress" role="status"><Check size={17} />{completed} {t('tasksCarried')}</p>}
      {failed && <p className="editor-error" role="alert">{t('carryStopped')}</p>}
      {tasks.length > 0 ? <>
        <div className="selection-actions"><strong>{t('tasks')} ({queue.length})</strong><button type="button" className="text-button" disabled={running} onClick={() => setSelected(available.map(task => task.id))}>{t('selectAll')}</button><button type="button" className="text-button" disabled={running} onClick={() => setSelected([])}>{t('clearSelection')}</button></div>
        <div className="carry-task-list">{tasks.map(task => {
          const linked = task.meetingIds.includes(destination);
          const person = workspace.people.find(item => item.id === task.assigneeId);
          return <label className={`carry-task-option ${linked ? 'already-linked' : ''}`} key={task.id}><input type="checkbox" checked={!linked && selected.includes(task.id)} disabled={running || linked} onChange={event => setSelected(ids => event.target.checked ? [...new Set([...ids, task.id])] : ids.filter(id => id !== task.id))} /><span><strong dir="auto">{task.title}</strong><span className="carry-task-meta"><bdi>{person?.name || t('unassigned')}</bdi> · {t(task.status)}{linked ? ` · ${t('alreadyLinked')}` : ''}</span></span></label>;
        })}</div>
      </> : <p className="muted">{t('noCarryTasks')}</p>}
    </div>
  </Sheet>;
}
