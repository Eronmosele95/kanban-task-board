import TaskCard from './TaskCard'

type Task = {
    id: string | number
    user_id: string
    title: string
    description: string | null
    priority: 'low' | 'medium' | 'high'
    due_date: string | null
    assignee_ids: string[]
    status: 'todo' | 'in_progress' | 'in_review' | 'done'
    created_at?: string
}

type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done'

type TeamMember = {
    id: string
    name: string
    avatar: string | null
    color: string
}

type ColumnProps = {
    status: TaskStatus
    title: string
    tasks: Task[]
    selectedTaskIds: ReadonlySet<Task['id']>
    onToggleSelection: (taskId: Task['id']) => void
    onDropTask: (status: TaskStatus) => void
    onColumnDragEnter: (status: TaskStatus) => void
    onTaskDragStart: (taskId: Task['id']) => void
    onTaskDragEnd: () => void
    onMoveTask: (taskId: Task['id'], status: TaskStatus) => void
    onTaskClick: (task: Task) => void
    teamMembers: TeamMember[]
    isDropTarget: boolean
    onDeleteSelected: () => void
    onClearAll: () => void
    isDeleting: boolean
    isClearing: boolean
}

const Column = ({
    status,
    title,
    tasks,
    selectedTaskIds,
    onToggleSelection,
    onDropTask,
    onColumnDragEnter,
    onTaskDragStart,
    onTaskDragEnd,
    onMoveTask,
    onTaskClick,
    teamMembers,
    isDropTarget,
    onDeleteSelected,
    onClearAll,
    isDeleting,
    isClearing,
}: ColumnProps) => {
    const selectedCount = tasks.filter((task) => selectedTaskIds.has(task.id)).length

    return (
        <section
            className={`kanban-column ${isDropTarget ? 'kanban-column-drop-target' : ''}`}
            onDragEnter={() => onColumnDragEnter(status)}
            onDragOver={(event) => {
                event.preventDefault()
                onColumnDragEnter(status)
            }}
            onDrop={(event) => {
                event.preventDefault()
                onDropTask(status)
            }}
        >
            <header className="kanban-column-header">
                <h3>{title}</h3>
                <div className="column-header-actions">
                    <span className="task-count" aria-label={`${tasks.length} tasks`}>
                        {tasks.length}
                    </span>
                    <button
                        type="button"
                        className="column-delete-button"
                        onClick={onDeleteSelected}
                        disabled={selectedCount === 0 || isDeleting || isClearing}
                    >
                        {isDeleting ? 'Deleting...' : `Delete Selected (${selectedCount})`}
                    </button>
                    <button
                        type="button"
                        className="column-clear-button"
                        onClick={onClearAll}
                        disabled={tasks.length === 0 || isDeleting || isClearing}
                    >
                        {isClearing ? 'Clearing...' : 'Clear All'}
                    </button>
                </div>
            </header>
            {tasks.length === 0 ? (
                <p className="column-empty">No tasks yet.</p>
            ) : (
                tasks.map((task) => (
                    <TaskCard
                        key={task.id}
                        task={task}
                        isSelected={selectedTaskIds.has(task.id)}
                        onToggleSelection={onToggleSelection}
                        onDragStart={onTaskDragStart}
                        onDragEnd={onTaskDragEnd}
                        onMoveTask={onMoveTask}
                        onTaskClick={onTaskClick}
                        teamMembers={teamMembers}
                    />
                ))
            )}
        </section>
    )
}

export default Column
