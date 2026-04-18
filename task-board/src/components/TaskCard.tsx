import { useState } from 'react'

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

type TaskCardProps = {
    task: Task
    isSelected: boolean
    onToggleSelection: (taskId: Task['id']) => void
    onDragStart: (taskId: Task['id']) => void
    onDragEnd: () => void
    onMoveTask: (taskId: Task['id'], status: TaskStatus) => void
    onTaskClick: (task: Task) => void
    teamMembers: TeamMember[]
}

const TaskCard = ({
    task,
    isSelected,
    onToggleSelection,
    onDragStart,
    onDragEnd,
    onMoveTask,
    onTaskClick,
    teamMembers,
}: TaskCardProps) => {
    const [targetStatus, setTargetStatus] = useState<TaskStatus>(task.status)
    const assignees = (task.assignee_ids ?? [])
        .map((assigneeId) => teamMembers.find((member) => member.id === assigneeId))
        .filter((member): member is TeamMember => Boolean(member))

    const handleMove = () => {
        onMoveTask(task.id, targetStatus)
    }

    return (
        <article
            className={`task-card ${isSelected ? 'task-card-selected' : ''}`}
            draggable
            onDragStart={() => onDragStart(task.id)}
            onDragEnd={onDragEnd}
        >
            <label className="task-card-select">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelection(task.id)}
                    aria-label={`Select task: ${task.title}`}
                />
                <span>Select</span>
            </label>
            <button
                type="button"
                className="task-card-title-button"
                onClick={() => onTaskClick(task)}
                aria-label={`Open task details: ${task.title}`}
            >
                <h4>{task.title}</h4>
            </button>
            <div className="task-meta-row">
                <span className={`task-priority task-priority-${task.priority}`}>
                    {task.priority} priority
                </span>
                <span className="task-due-date">
                    {task.due_date ? `Due ${task.due_date}` : 'No due date'}
                </span>
            </div>
            <div className="task-assignees-row" aria-label="Task assignees">
                {assignees.length === 0 ? (
                    <span className="task-no-assignees">Unassigned</span>
                ) : (
                    assignees.map((member) => (
                        <span
                            key={member.id}
                            className="member-avatar member-avatar-sm"
                            style={{ backgroundColor: member.color }}
                            title={member.name}
                        >
                            {member.avatar || member.name.slice(0, 1).toUpperCase()}
                        </span>
                    ))
                )}
            </div>
            {task.description ? <p>{task.description}</p> : <p className="task-empty">No description</p>}
            <div className="task-move-controls">
                <label htmlFor={`move-${task.id}`}>Move to</label>
                <select
                    id={`move-${task.id}`}
                    value={targetStatus}
                    onChange={(event) => setTargetStatus(event.target.value as TaskStatus)}
                >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="in_review">In Review</option>
                    <option value="done">Done</option>
                </select>
                <button type="button" onClick={handleMove} disabled={targetStatus === task.status}>
                    Move
                </button>
            </div>
        </article>
    )
}

export default TaskCard
