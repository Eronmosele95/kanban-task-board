import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './TaskDetail.css'

type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done'
type TaskPriority = 'low' | 'medium' | 'high'

type TeamMember = {
    id: string
    name: string
    avatar: string | null
    color: string
}

type Task = {
    id: string | number
    user_id: string
    title: string
    description: string | null
    priority: TaskPriority
    due_date: string | null
    assignee_ids: string[]
    status: TaskStatus
    created_at?: string
}

type ActivityLog = {
    id: number
    action_type: string
    details: Record<string, any> | null
    created_at: string
}

const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: 'To Do',
    in_progress: 'In Progress',
    in_review: 'In Review',
    done: 'Done',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
}

interface TaskDetailProps {
    task: Task | null
    teamMembers: TeamMember[]
    onUpdateTask: (
        taskId: Task['id'],
        updates: Partial<
            Pick<Task, 'title' | 'description' | 'priority' | 'status' | 'due_date' | 'assignee_ids'>
        >
    ) => Promise<void>
    onClose: () => void
}

const formatRelativeTime = (timestamp: string): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`

    return date.toLocaleDateString()
}

const getActivityDescription = (activity: ActivityLog, teamMembers: TeamMember[]): string => {
    const details = activity.details || {}

    switch (activity.action_type) {
        case 'created':
            return 'Created task'

        case 'status_changed':
            const fromStatus = details.from_status && STATUS_LABELS[details.from_status as TaskStatus]
                ? STATUS_LABELS[details.from_status as TaskStatus]
                : 'Unknown'
            const toStatus = details.to_status && STATUS_LABELS[details.to_status as TaskStatus]
                ? STATUS_LABELS[details.to_status as TaskStatus]
                : 'Unknown'
            return `Moved from ${fromStatus} → ${toStatus}`

        case 'priority_changed':
            const fromPriority = details.from_priority && PRIORITY_LABELS[details.from_priority as TaskPriority]
                ? PRIORITY_LABELS[details.from_priority as TaskPriority]
                : 'Unknown'
            const toPriority = details.to_priority && PRIORITY_LABELS[details.to_priority as TaskPriority]
                ? PRIORITY_LABELS[details.to_priority as TaskPriority]
                : 'Unknown'
            return `Priority changed: ${fromPriority} → ${toPriority}`

        case 'assigned':
            const assignedNames = (details.member_ids as string[])
                ?.map((id) => teamMembers.find((m) => m.id === id)?.name || 'Unknown')
                .join(', ')
            return `Assigned to ${assignedNames}`

        case 'unassigned':
            const unassignedNames = (details.member_ids as string[])
                ?.map((id) => teamMembers.find((m) => m.id === id)?.name || 'Unknown')
                .join(', ')
            return `Unassigned from ${unassignedNames}`

        case 'title_changed':
            return `Title updated: "${details.new_title || ''}"`

        case 'description_changed':
            return 'Description updated'

        default:
            return 'Activity recorded'
    }
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, teamMembers, onUpdateTask, onClose }) => {
    const [activities, setActivities] = useState<ActivityLog[]>([])
    const [isLoadingActivities, setIsLoadingActivities] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState('')
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        priority: 'medium' as TaskPriority,
        status: 'todo' as TaskStatus,
        dueDate: '',
        assigneeIds: [] as string[],
    })

    const resetEditFormFromTask = (currentTask: Task) => {
        setEditForm({
            title: currentTask.title,
            description: currentTask.description ?? '',
            priority: currentTask.priority,
            status: currentTask.status,
            dueDate: currentTask.due_date ?? '',
            assigneeIds: currentTask.assignee_ids ?? [],
        })
    }

    useEffect(() => {
        if (!task) return

        setIsEditing(false)
        setSaveError('')
        resetEditFormFromTask(task)

        if (!supabase) {
            setIsLoadingActivities(false)
            return
        }

        const loadActivities = async () => {
            if (!supabase) return

            setIsLoadingActivities(true)
            const { data, error } = await supabase
                .from('activity_logs')
                .select('*')
                .eq('task_id', task.id)
                .order('created_at', { ascending: false })

            if (!error && data) {
                setActivities(data as ActivityLog[])
            }
            setIsLoadingActivities(false)
        }

        loadActivities()
    }, [task])

    useEffect(() => {
        if (!task || !isEditing) {
            return
        }

        const handleShortcut = (event: KeyboardEvent) => {
            const isSaveCombo = (event.metaKey || event.ctrlKey) && event.key === 'Enter'
            if (isSaveCombo) {
                event.preventDefault()
                if (!isSaving) {
                    void handleSaveChanges()
                }
                return
            }

            if (event.key === 'Escape') {
                event.preventDefault()
                if (!isSaving) {
                    resetEditFormFromTask(task)
                    setSaveError('')
                    setIsEditing(false)
                }
            }
        }

        window.addEventListener('keydown', handleShortcut)

        return () => {
            window.removeEventListener('keydown', handleShortcut)
        }
    }, [task, isEditing, isSaving])

    if (!task) return null

    const assignedMembers = teamMembers.filter((m) => task.assignee_ids.includes(m.id))

    const handleToggleAssignee = (memberId: string) => {
        setEditForm((prev) => {
            const alreadySelected = prev.assigneeIds.includes(memberId)
            return {
                ...prev,
                assigneeIds: alreadySelected
                    ? prev.assigneeIds.filter((id) => id !== memberId)
                    : [...prev.assigneeIds, memberId],
            }
        })
    }

    const handleSaveChanges = async () => {
        setSaveError('')
        setIsSaving(true)

        try {
            await onUpdateTask(task.id, {
                title: editForm.title,
                description: editForm.description,
                priority: editForm.priority,
                status: editForm.status,
                due_date: editForm.dueDate,
                assignee_ids: editForm.assigneeIds,
            })
            setIsEditing(false)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to save task changes.'
            setSaveError(message)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="task-detail-overlay" onClick={onClose}>
            <div className="task-detail-modal" onClick={(e) => e.stopPropagation()}>
                <button className="task-detail-close" onClick={onClose} aria-label="Close task detail">
                    ×
                </button>

                <div className="task-detail-content">
                    <div className="task-detail-header">
                        {isEditing ? (
                            <input
                                className="task-title-input"
                                value={editForm.title}
                                onChange={(event) =>
                                    setEditForm((prev) => ({
                                        ...prev,
                                        title: event.target.value,
                                    }))
                                }
                                aria-label="Task title"
                            />
                        ) : (
                            <h2>{task.title}</h2>
                        )}

                        <div className="task-meta-badges">
                            <span className={`task-priority-badge task-priority-${task.priority}`}>
                                {PRIORITY_LABELS[task.priority]}
                            </span>
                            <span className="task-status-badge">{STATUS_LABELS[task.status]}</span>
                        </div>

                        <div className="task-detail-actions">
                            {isEditing ? (
                                <>
                                    <button
                                        type="button"
                                        className="task-detail-action secondary"
                                        onClick={() => {
                                            resetEditFormFromTask(task)
                                            setSaveError('')
                                            setIsEditing(false)
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button type="button" className="task-detail-action" onClick={handleSaveChanges} disabled={isSaving}>
                                        {isSaving ? 'Saving...' : 'Save changes'}
                                    </button>
                                    <p className="task-shortcut-hint" aria-label="Edit shortcuts">
                                        Tip: <kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> to save, <kbd>Esc</kbd> to cancel.
                                    </p>
                                </>
                            ) : (
                                <button type="button" className="task-detail-action" onClick={() => setIsEditing(true)}>
                                    Edit task
                                </button>
                            )}
                        </div>
                    </div>

                    {saveError ? <p className="task-save-error">{saveError}</p> : null}

                    <div className="task-detail-section">
                        <h3>Description</h3>
                        {isEditing ? (
                            <textarea
                                className="task-description-input"
                                value={editForm.description}
                                onChange={(event) =>
                                    setEditForm((prev) => ({
                                        ...prev,
                                        description: event.target.value,
                                    }))
                                }
                                rows={4}
                            />
                        ) : task.description ? (
                            <p className="task-description-text">{task.description}</p>
                        ) : (
                            <p className="task-description-text">No description</p>
                        )}
                    </div>

                    <div className="task-detail-section">
                        <h3>Details</h3>
                        <div className="task-detail-grid">
                            <div className="detail-item">
                                <span className="detail-label">Priority:</span>
                                {isEditing ? (
                                    <select
                                        className="task-detail-select"
                                        value={editForm.priority}
                                        onChange={(event) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                priority: event.target.value as TaskPriority,
                                            }))
                                        }
                                    >
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                ) : (
                                    <span className="detail-value">{PRIORITY_LABELS[task.priority]}</span>
                                )}
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Status:</span>
                                {isEditing ? (
                                    <select
                                        className="task-detail-select"
                                        value={editForm.status}
                                        onChange={(event) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                status: event.target.value as TaskStatus,
                                            }))
                                        }
                                    >
                                        <option value="todo">To Do</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="in_review">In Review</option>
                                        <option value="done">Done</option>
                                    </select>
                                ) : (
                                    <span className="detail-value">{STATUS_LABELS[task.status]}</span>
                                )}
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Due:</span>
                                {isEditing ? (
                                    <input
                                        type="date"
                                        className="task-detail-input"
                                        value={editForm.dueDate}
                                        onChange={(event) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                dueDate: event.target.value,
                                            }))
                                        }
                                    />
                                ) : (
                                    <span className="detail-value">
                                        {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="task-detail-section">
                        <h3>Assigned To</h3>
                        {isEditing ? (
                            teamMembers.length === 0 ? (
                                <p className="activity-empty">No team members available.</p>
                            ) : (
                                <div className="task-assignee-picker">
                                    {teamMembers.map((member) => (
                                        <label key={member.id} className="task-assignee-option">
                                            <input
                                                type="checkbox"
                                                checked={editForm.assigneeIds.includes(member.id)}
                                                onChange={() => handleToggleAssignee(member.id)}
                                            />
                                            <span className="member-avatar" style={{ backgroundColor: member.color }}>
                                                {member.avatar || member.name.slice(0, 1).toUpperCase()}
                                            </span>
                                            <span>{member.name}</span>
                                        </label>
                                    ))}
                                </div>
                            )
                        ) : assignedMembers.length > 0 ? (
                            <div className="task-assignees">
                                {assignedMembers.map((member) => (
                                    <div key={member.id} className="task-assignee-item">
                                        <span
                                            className="member-avatar"
                                            style={{ backgroundColor: member.color }}
                                        >
                                            {member.avatar || member.name.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span>{member.name}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="activity-empty">No assignees yet.</p>
                        )}
                    </div>

                    <div className="task-detail-section">
                        <h3>Activity Timeline</h3>
                        {isLoadingActivities ? (
                            <p className="activity-loading">Loading activities...</p>
                        ) : activities.length === 0 ? (
                            <p className="activity-empty">No activities recorded yet</p>
                        ) : (
                            <div className="activity-timeline">
                                {activities.map((activity) => (
                                    <div key={activity.id} className="activity-item">
                                        <div className="activity-dot" />
                                        <div className="activity-content">
                                            <p className="activity-description">
                                                {getActivityDescription(activity, teamMembers)}
                                            </p>
                                            <span className="activity-time">
                                                {formatRelativeTime(activity.created_at)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TaskDetail
