import { useEffect, useMemo, useRef, useState } from 'react'
import Column from './Column'
import TaskDetail from './TaskDetail'
import { ensureGuestSession, isSupabaseConfigured, supabase } from '../lib/supabase'
import './Board.css'

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

type TaskUpdatePayload = Partial<
    Pick<Task, 'title' | 'description' | 'priority' | 'due_date' | 'assignee_ids' | 'status'>
>

type UndoSnapshot = {
    tasks: Task[]
    message: string
}

const PRESET_COLORS = [
    { label: 'Blue', hex: '#2f6feb' },
    { label: 'Red', hex: '#dc2626' },
    { label: 'Orange', hex: '#f97316' },
    { label: 'Green', hex: '#059669' },
    { label: 'Purple', hex: '#7c3aed' },
    { label: 'Pink', hex: '#ec4899' },
    { label: 'Teal', hex: '#0891b2' },
    { label: 'Amber', hex: '#d97706' },
]

const initialForm = {
    title: '',
    description: '',
    priority: 'medium' as TaskPriority,
    dueDate: '',
    assigneeIds: [] as string[],
    status: 'todo' as TaskStatus,
}

const isMissingDescriptionColumnError = (message: string) =>
    message.includes("'description' column") && message.includes('schema cache')

const CLOCK_TIME_ZONES = [
    { label: 'Local', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { label: 'UTC', timeZone: 'UTC' },
    { label: 'New York', timeZone: 'America/New_York' },
    { label: 'London', timeZone: 'Europe/London' },
    { label: 'Tokyo', timeZone: 'Asia/Tokyo' },
    { label: 'Lagos', timeZone: 'Africa/Lagos' },
    { label: 'Dubai', timeZone: 'Asia/Dubai' },
    { label: 'Singapore', timeZone: 'Asia/Singapore' },
    { label: 'Sydney', timeZone: 'Australia/Sydney' },
    { label: 'Los Angeles', timeZone: 'America/Los_Angeles' },
    { label: 'Chicago', timeZone: 'America/Chicago' },
]

const DEFAULT_CLOCK_TIME_ZONES = CLOCK_TIME_ZONES.slice(0, 5).map((zone) => zone.timeZone)
const DEFAULT_FALLBACK_ADD_ZONE = 'Africa/Lagos'

const Board = () => {
    const [form, setForm] = useState(initialForm)
    const [tasks, setTasks] = useState<Task[]>([])
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<Task['id']>>(new Set())
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [deletingStatus, setDeletingStatus] = useState<TaskStatus | null>(null)
    const [clearingStatus, setClearingStatus] = useState<TaskStatus | null>(null)
    const [hasDescriptionColumn, setHasDescriptionColumn] = useState<boolean | null>(null)
    const [hasShownDescriptionWarning, setHasShownDescriptionWarning] = useState(false)
    const [draggedTaskId, setDraggedTaskId] = useState<Task['id'] | null>(null)
    const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null)
    const [currentUserId, setCurrentUserId] = useState<string | null>(null)
    const [isAuthReady, setIsAuthReady] = useState(!isSupabaseConfigured)
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
    const [memberForm, setMemberForm] = useState({
        name: '',
        avatar: '',
        color: '#2f6feb',
    })
    const [errorMessage, setErrorMessage] = useState('')
    const [loadError, setLoadError] = useState('')
    const [searchText, setSearchText] = useState('')
    const [selectedPriority, setSelectedPriority] = useState<TaskPriority | 'all'>('all')
    const [selectedAssignee, setSelectedAssignee] = useState<string | 'all'>('all')
    const [selectedTask, setSelectedTask] = useState<Task | null>(null)
    const [bulkTargetStatus, setBulkTargetStatus] = useState<TaskStatus>('in_progress')
    const [bulkTargetPriority, setBulkTargetPriority] = useState<TaskPriority>('medium')
    const [isApplyingBulk, setIsApplyingBulk] = useState(false)
    const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null)
    const [clockNow, setClockNow] = useState(() => new Date())
    const [selectedClockTimeZones, setSelectedClockTimeZones] = useState<string[]>(DEFAULT_CLOCK_TIME_ZONES)
    const [clockZoneToAdd, setClockZoneToAdd] = useState<string>(DEFAULT_FALLBACK_ADD_ZONE)
    const [use12HourClock, setUse12HourClock] = useState(false)

    const undoTimerRef = useRef<number | null>(null)

    const teamStorageKey = currentUserId ? `kanban-team-${currentUserId}` : null
    const clockStorageKey = currentUserId ? `kanban-timezones-${currentUserId}` : null
    const clockFormatStorageKey = currentUserId ? `kanban-clock-format-${currentUserId}` : null

    const calendarDay = useMemo(
        () => new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(clockNow),
        [clockNow]
    )
    const calendarMonth = useMemo(
        () => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(clockNow),
        [clockNow]
    )
    const calendarWeekday = useMemo(
        () => new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(clockNow),
        [clockNow]
    )
    const calendarYear = useMemo(
        () => new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(clockNow),
        [clockNow]
    )
    const timezoneClocks = useMemo(
        () =>
            selectedClockTimeZones
                .map((zoneId) => CLOCK_TIME_ZONES.find((zone) => zone.timeZone === zoneId))
                .filter((zone): zone is { label: string; timeZone: string } => Boolean(zone))
                .map((zone) => ({
                    ...zone,
                    time: new Intl.DateTimeFormat(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: use12HourClock,
                        timeZone: zone.timeZone,
                    }).format(clockNow),
                })),
        [clockNow, selectedClockTimeZones, use12HourClock]
    )

    const availableClockZoneOptions = useMemo(
        () => CLOCK_TIME_ZONES.filter((zone) => !selectedClockTimeZones.includes(zone.timeZone)),
        [selectedClockTimeZones]
    )

    const isClockZoneSelectionDefault = useMemo(() => {
        if (selectedClockTimeZones.length !== DEFAULT_CLOCK_TIME_ZONES.length) {
            return false
        }

        return DEFAULT_CLOCK_TIME_ZONES.every((zone, index) => selectedClockTimeZones[index] === zone)
    }, [selectedClockTimeZones])

    useEffect(() => {
        if (availableClockZoneOptions.length === 0) {
            return
        }

        const stillAvailable = availableClockZoneOptions.some((zone) => zone.timeZone === clockZoneToAdd)
        if (!stillAvailable) {
            setClockZoneToAdd(availableClockZoneOptions[0].timeZone)
        }
    }, [availableClockZoneOptions, clockZoneToAdd])

    const handleAddClockZone = () => {
        if (!clockZoneToAdd || selectedClockTimeZones.includes(clockZoneToAdd)) {
            return
        }

        setSelectedClockTimeZones((prev) => [...prev, clockZoneToAdd])
    }

    const handleResetClockZones = () => {
        setSelectedClockTimeZones(DEFAULT_CLOCK_TIME_ZONES)
        const nextAddZone = CLOCK_TIME_ZONES.find(
            (zone) => !DEFAULT_CLOCK_TIME_ZONES.includes(zone.timeZone)
        )
        setClockZoneToAdd(nextAddZone?.timeZone ?? DEFAULT_FALLBACK_ADD_ZONE)
    }
    const handleRemoveClockZone = (zoneId: string) => {
        setSelectedClockTimeZones((prev) => {
            if (prev.length === 1) {
                return prev
            }
            return prev.filter((id) => id !== zoneId)
        })
    }

    const logActivity = async (
        taskId: Task['id'],
        actionType: string,
        details?: Record<string, any>
    ) => {
        if (!supabase || !currentUserId) return

        await supabase.from('activity_logs').insert({
            user_id: currentUserId,
            task_id: taskId,
            action_type: actionType,
            details: details || null,
        })
    }

    const handleTaskClick = (task: Task) => {
        setSelectedTask(task)
    }

    const clearUndoSnapshot = () => {
        if (undoTimerRef.current !== null) {
            window.clearTimeout(undoTimerRef.current)
            undoTimerRef.current = null
        }
        setUndoSnapshot(null)
    }

    const pushUndoSnapshot = (tasksToRestore: Task[], message: string) => {
        if (tasksToRestore.length === 0) {
            return
        }

        if (undoTimerRef.current !== null) {
            window.clearTimeout(undoTimerRef.current)
        }

        setUndoSnapshot({
            tasks: tasksToRestore,
            message,
        })

        undoTimerRef.current = window.setTimeout(() => {
            setUndoSnapshot(null)
            undoTimerRef.current = null
        }, 7000)
    }

    const toTaskInsertPayload = (task: Task) => {
        const basePayload = {
            title: task.title,
            user_id: currentUserId,
            priority: task.priority,
            due_date: task.due_date,
            assignee_ids: task.assignee_ids,
            status: task.status,
        }

        if (hasDescriptionColumn === false) {
            return basePayload
        }

        return {
            ...basePayload,
            description: task.description,
        }
    }

    const loadTasks = async () => {
        setIsLoading(true)
        setLoadError('')

        if (!supabase) {
            setTasks([])
            setLoadError(
                'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to load saved tasks.'
            )
            setIsLoading(false)
            return
        }

        if (!currentUserId) {
            setTasks([])
            setLoadError('Guest session is not ready yet. Please retry in a moment.')
            setIsLoading(false)
            return
        }

        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false })

        if (error) {
            setLoadError(error.message)
            setIsLoading(false)
            return
        }

        const nextTasks = ((data as Task[]) ?? []).map((task) => ({
            ...task,
            assignee_ids: task.assignee_ids ?? [],
        }))

        setTasks(nextTasks)
        setIsLoading(false)
    }

    useEffect(() => {
        if (!supabase) {
            return
        }

        let isMounted = true

        const initializeGuestSession = async () => {
            setLoadError('')
            setIsAuthReady(false)

            const { userId, error } = await ensureGuestSession()

            if (!isMounted) {
                return
            }

            if (error || !userId) {
                setCurrentUserId(null)
                setLoadError(error ?? 'Unable to start a guest session.')
                setIsAuthReady(true)
                return
            }

            setCurrentUserId(userId)
            setIsAuthReady(true)
        }

        initializeGuestSession()

        const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (!isMounted) {
                return
            }

            const sessionUserId = session?.user?.id

            if (sessionUserId) {
                setCurrentUserId(sessionUserId)
                return
            }

            const { userId } = await ensureGuestSession()

            if (isMounted) {
                setCurrentUserId(userId)
            }
        })

        return () => {
            isMounted = false
            authListener.subscription.unsubscribe()
        }
    }, [])

    useEffect(() => {
        const timer = window.setInterval(() => {
            setClockNow(new Date())
        }, 1000)

        return () => {
            window.clearInterval(timer)
        }
    }, [])

    useEffect(() => {
        if (!isSupabaseConfigured) {
            return
        }

        if (!isAuthReady) {
            return
        }

        if (!currentUserId) {
            setTasks([])
            return
        }

        loadTasks()
    }, [isAuthReady, currentUserId])

    useEffect(() => {
        setSelectedTaskIds((prev) => {
            const remainingTaskIds = new Set(tasks.map((task) => task.id))
            const next = new Set(Array.from(prev).filter((taskId) => remainingTaskIds.has(taskId)))
            return next
        })
    }, [tasks])

    useEffect(() => {
        return () => {
            if (undoTimerRef.current !== null) {
                window.clearTimeout(undoTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (!teamStorageKey) {
            setTeamMembers([])
            return
        }

        const raw = window.localStorage.getItem(teamStorageKey)
        if (!raw) {
            setTeamMembers([])
            return
        }

        try {
            const parsed = JSON.parse(raw) as TeamMember[]
            setTeamMembers(parsed)
        } catch {
            setTeamMembers([])
        }
    }, [teamStorageKey])

    useEffect(() => {
        if (!teamStorageKey) {
            return
        }

        window.localStorage.setItem(teamStorageKey, JSON.stringify(teamMembers))
    }, [teamMembers, teamStorageKey])

    useEffect(() => {
        if (!clockStorageKey) {
            setSelectedClockTimeZones(DEFAULT_CLOCK_TIME_ZONES)
            return
        }

        const raw = window.localStorage.getItem(clockStorageKey)
        if (!raw) {
            setSelectedClockTimeZones(DEFAULT_CLOCK_TIME_ZONES)
            return
        }

        try {
            const parsed = JSON.parse(raw) as string[]
            const sanitized = parsed.filter((zoneId) =>
                CLOCK_TIME_ZONES.some((zone) => zone.timeZone === zoneId)
            )
            setSelectedClockTimeZones(sanitized.length > 0 ? sanitized : DEFAULT_CLOCK_TIME_ZONES)
        } catch {
            setSelectedClockTimeZones(DEFAULT_CLOCK_TIME_ZONES)
        }
    }, [clockStorageKey])

    useEffect(() => {
        if (!clockStorageKey) {
            return
        }

        window.localStorage.setItem(clockStorageKey, JSON.stringify(selectedClockTimeZones))
    }, [clockStorageKey, selectedClockTimeZones])

    useEffect(() => {
        if (!clockFormatStorageKey) {
            setUse12HourClock(false)
            return
        }

        const raw = window.localStorage.getItem(clockFormatStorageKey)
        if (!raw) {
            setUse12HourClock(false)
            return
        }

        setUse12HourClock(raw === '12h')
    }, [clockFormatStorageKey])

    useEffect(() => {
        if (!clockFormatStorageKey) {
            return
        }

        window.localStorage.setItem(clockFormatStorageKey, use12HourClock ? '12h' : '24h')
    }, [clockFormatStorageKey, use12HourClock])

    const filteredTasks = useMemo(() => {
        return tasks.filter((task) => {
            // Search filter
            const matchesSearch = task.title.toLowerCase().includes(searchText.toLowerCase())

            // Priority filter
            const matchesPriority = selectedPriority === 'all' || task.priority === selectedPriority

            // Assignee filter
            const matchesAssignee = selectedAssignee === 'all' || task.assignee_ids.includes(selectedAssignee)

            return matchesSearch && matchesPriority && matchesAssignee
        })
    }, [tasks, searchText, selectedPriority, selectedAssignee])

    const tasksByStatus = useMemo(
        () => ({
            todo: filteredTasks.filter((task) => task.status === 'todo'),
            in_progress: filteredTasks.filter((task) => task.status === 'in_progress'),
            in_review: filteredTasks.filter((task) => task.status === 'in_review'),
            done: filteredTasks.filter((task) => task.status === 'done'),
        }),
        [filteredTasks]
    )

    const selectedTasks = useMemo(
        () => tasks.filter((task) => selectedTaskIds.has(task.id)),
        [tasks, selectedTaskIds]
    )

    const totalTasks = filteredTasks.length
    const completedTasks = tasksByStatus.done.length
    const inFlightTasks = tasksByStatus.in_progress.length + tasksByStatus.in_review.length
    const backlogTasks = tasksByStatus.todo.length
    const selectedTaskCount = selectedTasks.length
    const isBusy = isLoading || isSaving || isApplyingBulk

    const deleteTasksByIds = async (idsToDelete: Array<Task['id']>, message: string) => {
        const idsSet = new Set(idsToDelete)
        const removedTasks = tasks.filter((task) => idsSet.has(task.id))

        if (removedTasks.length === 0) {
            return
        }

        if (supabase) {
            const deleteQuery = supabase.from('tasks').delete().in('id', idsToDelete)
            const { error } = currentUserId
                ? await deleteQuery.eq('user_id', currentUserId)
                : await deleteQuery

            if (error) {
                setErrorMessage(error.message)
                return
            }
        }

        setTasks((prev) => prev.filter((task) => !idsSet.has(task.id)))
        setSelectedTaskIds((prev) => {
            const next = new Set(prev)
            idsToDelete.forEach((id) => next.delete(id))
            return next
        })
        setSelectedTask((prev) => (prev && idsSet.has(prev.id) ? null : prev))
        pushUndoSnapshot(removedTasks, message)
    }

    const handleUndoLastAction = async () => {
        if (!undoSnapshot) {
            return
        }

        const tasksToRestore = undoSnapshot.tasks
        clearUndoSnapshot()
        setErrorMessage('')

        if (!supabase) {
            setTasks((prev) => [...tasksToRestore, ...prev])
            return
        }

        const payload = tasksToRestore.map(toTaskInsertPayload)

        const { data, error } = await supabase.from('tasks').insert(payload).select('*')

        if (error && isMissingDescriptionColumnError(error.message)) {
            setHasDescriptionColumn(false)

            const fallbackPayload = tasksToRestore.map((task) => ({
                title: task.title,
                user_id: currentUserId,
                priority: task.priority,
                due_date: task.due_date,
                assignee_ids: task.assignee_ids,
                status: task.status,
            }))

            const { data: fallbackData, error: fallbackError } = await supabase
                .from('tasks')
                .insert(fallbackPayload)
                .select('*')

            if (fallbackError) {
                setErrorMessage(fallbackError.message)
                return
            }

            const restoredFallback = ((fallbackData as Task[]) ?? []).map((task) => ({
                ...task,
                assignee_ids: task.assignee_ids ?? [],
            }))
            setTasks((prev) => [...restoredFallback, ...prev])
            return
        }

        if (error) {
            setErrorMessage(error.message)
            return
        }

        const restoredTasks = ((data as Task[]) ?? []).map((task) => ({
            ...task,
            assignee_ids: task.assignee_ids ?? [],
        }))

        setTasks((prev) => [...restoredTasks, ...prev])
    }

    const handleChange = (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => {
        const { name, value } = event.target
        setForm((prev) => ({
            ...prev,
            [name]: name === 'status' ? (value as TaskStatus) : value,
        }))
    }

    const handleMemberFormChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target
        setMemberForm((prev) => ({
            ...prev,
            [name]: value,
        }))
    }

    const handleAddMember = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const trimmedName = memberForm.name.trim()
        if (!trimmedName) {
            setErrorMessage('Team member name is required.')
            return
        }

        const nextMember: TeamMember = {
            id: `member-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            name: trimmedName,
            avatar: memberForm.avatar.trim() || null,
            color: memberForm.color,
        }

        setErrorMessage('')
        setTeamMembers((prev) => [nextMember, ...prev])
        setMemberForm({
            name: '',
            avatar: '',
            color: '#2f6feb',
        })
    }

    const handleToggleAssignee = (memberId: string) => {
        setForm((prev) => {
            const alreadySelected = prev.assigneeIds.includes(memberId)
            return {
                ...prev,
                assigneeIds: alreadySelected
                    ? prev.assigneeIds.filter((id) => id !== memberId)
                    : [...prev.assigneeIds, memberId],
            }
        })
    }

    const handleCreateTask = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setErrorMessage('')

        if (!supabase) {
            setErrorMessage(
                'Supabase is not configured, so new tasks cannot be saved yet.'
            )
            return
        }

        if (!currentUserId) {
            setErrorMessage('Guest session is not ready. Please wait a moment and try again.')
            return
        }

        if (!form.title.trim()) {
            setErrorMessage('Task title is required.')
            return
        }

        setIsSaving(true)

        const trimmedDescription = form.description.trim()
        const normalizedDescription = trimmedDescription.length > 0 ? trimmedDescription : null
        const normalizedDueDate = form.dueDate || null

        const taskPayload = hasDescriptionColumn === false
            ? {
                title: form.title.trim(),
                user_id: currentUserId,
                priority: form.priority,
                due_date: normalizedDueDate,
                assignee_ids: form.assigneeIds,
                status: form.status,
            }
            : {
                title: form.title.trim(),
                description: normalizedDescription,
                user_id: currentUserId,
                priority: form.priority,
                due_date: normalizedDueDate,
                assignee_ids: form.assigneeIds,
                status: form.status,
            }

        const { data, error } = await supabase
            .from('tasks')
            .insert([taskPayload])
            .select()
            .single()

        if (error && isMissingDescriptionColumnError(error.message)) {
            setHasDescriptionColumn(false)

            const fallbackPayload = {
                title: form.title.trim(),
                user_id: currentUserId,
                priority: form.priority,
                due_date: normalizedDueDate,
                assignee_ids: form.assigneeIds,
                status: form.status,
            }

            const { data: fallbackData, error: fallbackError } = await supabase
                .from('tasks')
                .insert([fallbackPayload])
                .select()
                .single()

            setIsSaving(false)

            if (fallbackError) {
                setErrorMessage(fallbackError.message)
                return
            }

            if (!hasShownDescriptionWarning) {
                setErrorMessage(
                    'Task created, but description was skipped because your Supabase tasks table is missing that column. Add a description TEXT column to save descriptions.'
                )
                setHasShownDescriptionWarning(true)
            }

            setTasks((prev) => [
                {
                    ...(fallbackData as Task),
                    description: null,
                    assignee_ids: (fallbackData as Task).assignee_ids ?? [],
                },
                ...prev,
            ])
            setForm(initialForm)

            // Log activity
            if (fallbackData) {
                await logActivity((fallbackData as Task).id, 'created')
            }
            return
        }

        setIsSaving(false)

        if (error) {
            setErrorMessage(error.message)
            return
        }

        if (hasDescriptionColumn !== false) {
            setHasDescriptionColumn(true)
        }

        setTasks((prev) => [
            {
                ...(data as Task),
                assignee_ids: (data as Task).assignee_ids ?? [],
            },
            ...prev,
        ])
        setForm(initialForm)

        // Log activity
        if (data) {
            await logActivity((data as Task).id, 'created')
        }
    }

    const handleToggleSelection = (taskId: Task['id']) => {
        setSelectedTaskIds((prev) => {
            const next = new Set(prev)
            if (next.has(taskId)) {
                next.delete(taskId)
            } else {
                next.add(taskId)
            }
            return next
        })
    }

    const handleDeleteSelectedInColumn = async (status: TaskStatus) => {
        const idsToDelete = tasks
            .filter((task) => task.status === status && selectedTaskIds.has(task.id))
            .map((task) => task.id)

        if (idsToDelete.length === 0) {
            return
        }

        setErrorMessage('')
        setDeletingStatus(status)
        await deleteTasksByIds(idsToDelete, `Deleted ${idsToDelete.length} selected task(s).`)
        setDeletingStatus(null)
    }

    const handleClearAllInColumn = async (status: TaskStatus) => {
        const idsToDelete = tasks.filter((task) => task.status === status).map((task) => task.id)

        if (idsToDelete.length === 0) {
            return
        }

        setErrorMessage('')
        setClearingStatus(status)
        await deleteTasksByIds(idsToDelete, `Cleared ${idsToDelete.length} task(s) in ${status.replace('_', ' ')}.`)
        setClearingStatus(null)
    }

    const handleBulkMoveSelected = async () => {
        const selectedIds = Array.from(selectedTaskIds)
        if (selectedIds.length === 0) {
            return
        }

        const previousTasks = tasks
        const idsSet = new Set(selectedIds)
        setErrorMessage('')
        setIsApplyingBulk(true)

        setTasks((prev) =>
            prev.map((task) =>
                idsSet.has(task.id)
                    ? {
                        ...task,
                        status: bulkTargetStatus,
                    }
                    : task
            )
        )
        setSelectedTask((prev) =>
            prev && idsSet.has(prev.id)
                ? {
                    ...prev,
                    status: bulkTargetStatus,
                }
                : prev
        )

        if (supabase) {
            const { error } = await supabase
                .from('tasks')
                .update({ status: bulkTargetStatus })
                .in('id', selectedIds)
                .eq('user_id', currentUserId)

            if (error) {
                setTasks(previousTasks)
                setSelectedTask((prev) => {
                    if (!prev) return null
                    return previousTasks.find((task) => task.id === prev.id) ?? null
                })
                setErrorMessage(error.message)
            }
        }

        setIsApplyingBulk(false)
    }

    const handleBulkPriorityUpdate = async () => {
        const selectedIds = Array.from(selectedTaskIds)
        if (selectedIds.length === 0) {
            return
        }

        const previousTasks = tasks
        const idsSet = new Set(selectedIds)
        setErrorMessage('')
        setIsApplyingBulk(true)

        setTasks((prev) =>
            prev.map((task) =>
                idsSet.has(task.id)
                    ? {
                        ...task,
                        priority: bulkTargetPriority,
                    }
                    : task
            )
        )
        setSelectedTask((prev) =>
            prev && idsSet.has(prev.id)
                ? {
                    ...prev,
                    priority: bulkTargetPriority,
                }
                : prev
        )

        if (supabase) {
            const { error } = await supabase
                .from('tasks')
                .update({ priority: bulkTargetPriority })
                .in('id', selectedIds)
                .eq('user_id', currentUserId)

            if (error) {
                setTasks(previousTasks)
                setSelectedTask((prev) => {
                    if (!prev) return null
                    return previousTasks.find((task) => task.id === prev.id) ?? null
                })
                setErrorMessage(error.message)
            }
        }

        setIsApplyingBulk(false)
    }

    const handleBulkDeleteSelected = async () => {
        const selectedIds = Array.from(selectedTaskIds)
        if (selectedIds.length === 0) {
            return
        }

        setErrorMessage('')
        setIsApplyingBulk(true)
        await deleteTasksByIds(selectedIds, `Deleted ${selectedIds.length} selected task(s).`)
        setIsApplyingBulk(false)
    }

    const handleUpdateTask = async (taskId: Task['id'], updates: TaskUpdatePayload) => {
        const taskToUpdate = tasks.find((task) => task.id === taskId)
        if (!taskToUpdate) {
            return
        }

        const normalizedUpdates: TaskUpdatePayload = { ...updates }

        if (typeof normalizedUpdates.title === 'string') {
            normalizedUpdates.title = normalizedUpdates.title.trim()
            if (!normalizedUpdates.title) {
                throw new Error('Task title cannot be empty.')
            }
        }

        if (typeof normalizedUpdates.description === 'string') {
            const trimmedDescription = normalizedUpdates.description.trim()
            normalizedUpdates.description = trimmedDescription.length > 0 ? trimmedDescription : null
        }

        if (typeof normalizedUpdates.due_date === 'string') {
            normalizedUpdates.due_date = normalizedUpdates.due_date || null
        }

        const previousTask = taskToUpdate
        const nextTask = {
            ...taskToUpdate,
            ...normalizedUpdates,
        }

        setTasks((prev) => prev.map((task) => (task.id === taskId ? nextTask : task)))
        setSelectedTask((prev) => (prev && prev.id === taskId ? nextTask : prev))

        if (!supabase) {
            return
        }

        const baseUpdatePayload = {
            title: nextTask.title,
            priority: nextTask.priority,
            due_date: nextTask.due_date,
            assignee_ids: nextTask.assignee_ids,
            status: nextTask.status,
        }

        const updatePayload = hasDescriptionColumn === false
            ? baseUpdatePayload
            : {
                ...baseUpdatePayload,
                description: nextTask.description,
            }

        const updateQuery = supabase.from('tasks').update(updatePayload).eq('id', taskId)
        const { error } = currentUserId
            ? await updateQuery.eq('user_id', currentUserId)
            : await updateQuery

        if (error) {
            setTasks((prev) => prev.map((task) => (task.id === taskId ? previousTask : task)))
            setSelectedTask((prev) => (prev && prev.id === taskId ? previousTask : prev))
            throw new Error(error.message)
        }

        if (previousTask.title !== nextTask.title) {
            await logActivity(taskId, 'title_changed', { new_title: nextTask.title })
        }

        if ((previousTask.description ?? null) !== (nextTask.description ?? null)) {
            await logActivity(taskId, 'description_changed')
        }

        if (previousTask.priority !== nextTask.priority) {
            await logActivity(taskId, 'priority_changed', {
                from_priority: previousTask.priority,
                to_priority: nextTask.priority,
            })
        }

        if (previousTask.status !== nextTask.status) {
            await logActivity(taskId, 'status_changed', {
                from_status: previousTask.status,
                to_status: nextTask.status,
            })
        }

        const assignedNow = nextTask.assignee_ids.filter((id) => !previousTask.assignee_ids.includes(id))
        const unassignedNow = previousTask.assignee_ids.filter((id) => !nextTask.assignee_ids.includes(id))

        if (assignedNow.length > 0) {
            await logActivity(taskId, 'assigned', { member_ids: assignedNow })
        }

        if (unassignedNow.length > 0) {
            await logActivity(taskId, 'unassigned', { member_ids: unassignedNow })
        }
    }

    const handleTaskDragStart = (taskId: Task['id']) => {
        setDraggedTaskId(taskId)
        const task = tasks.find((item) => item.id === taskId)
        setDragOverStatus(task ? task.status : null)
    }

    const handleTaskDragEnd = () => {
        setDraggedTaskId(null)
        setDragOverStatus(null)
    }

    const handleColumnDragEnter = (status: TaskStatus) => {
        if (draggedTaskId === null) {
            return
        }

        setDragOverStatus(status)
    }

    const moveTaskToStatus = async (taskId: Task['id'], nextStatus: TaskStatus) => {
        const taskToMove = tasks.find((task) => task.id === taskId)
        if (!taskToMove) {
            return
        }

        const previousStatus = taskToMove.status

        if (previousStatus === nextStatus) {
            return
        }

        setErrorMessage('')

        // Optimistically move the task so the board updates immediately on drop.
        setTasks((prev) =>
            prev.map((task) =>
                task.id === taskId
                    ? {
                        ...task,
                        status: nextStatus,
                    }
                    : task
            )
        )

        handleTaskDragEnd()

        if (!supabase) {
            return
        }

        const { error } = await supabase
            .from('tasks')
            .update({ status: nextStatus })
            .eq('id', taskId)
            .eq('user_id', currentUserId)

        if (error) {
            setTasks((prev) =>
                prev.map((task) =>
                    task.id === taskId
                        ? {
                            ...task,
                            status: previousStatus,
                        }
                        : task
                )
            )
            setErrorMessage(error.message)
        } else {
            // Log status change activity
            await logActivity(taskId, 'status_changed', {
                from_status: previousStatus,
                to_status: nextStatus,
            })
        }
    }

    const handleTaskDrop = async (nextStatus: TaskStatus) => {
        if (draggedTaskId === null) {
            return
        }

        const taskId = draggedTaskId
        handleTaskDragEnd()
        await moveTaskToStatus(taskId, nextStatus)
    }

    return (
        <main className="board-page">
            <header className="board-shell">
                <div className="board-header">
                    <p className="board-kicker">Workspace / Kanban</p>
                    <h1>Kanban Task Board</h1>
                    <p className="board-subtitle">
                        A calm, Notion-inspired board for keeping work organized, visible, and easy to move.
                    </p>
                    <div className="board-metrics" aria-label="Task summary">
                        <div>
                            <strong>{totalTasks}</strong>
                            <span>Total tasks</span>
                        </div>
                        <div>
                            <strong>{backlogTasks}</strong>
                            <span>In backlog</span>
                        </div>
                        <div>
                            <strong>{inFlightTasks}</strong>
                            <span>In progress</span>
                        </div>
                        <div>
                            <strong>{completedTasks}</strong>
                            <span>Done</span>
                        </div>
                    </div>
                </div>

                <aside className="board-aside" aria-label="Board tips">
                    <p className="board-aside-label">Calendar & clock</p>
                    <div className="calendar-card" aria-label="Today calendar">
                        <p className="calendar-month">{calendarMonth}</p>
                        <p className="calendar-day">{calendarDay}</p>
                        <p className="calendar-weekday">{calendarWeekday}</p>
                        <p className="calendar-year">{calendarYear}</p>
                    </div>
                    <div className="timezone-clocks" aria-label="Timezone clocks">
                        {timezoneClocks.map((zone) => (
                            <div key={`${zone.label}-${zone.timeZone}`} className="timezone-clock-row">
                                <span>{zone.label}</span>
                                <strong>{zone.time}</strong>
                                <button
                                    type="button"
                                    className="timezone-remove"
                                    onClick={() => handleRemoveClockZone(zone.timeZone)}
                                    disabled={selectedClockTimeZones.length === 1}
                                    aria-label={`Remove ${zone.label} timezone`}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="clock-format-toggle" role="group" aria-label="Clock display format">
                        <button
                            type="button"
                            className={!use12HourClock ? 'is-active' : ''}
                            onClick={() => setUse12HourClock(false)}
                            aria-pressed={!use12HourClock}
                        >
                            24-hour
                        </button>
                        <button
                            type="button"
                            className={use12HourClock ? 'is-active' : ''}
                            onClick={() => setUse12HourClock(true)}
                            aria-pressed={use12HourClock}
                        >
                            12-hour (AM/PM)
                        </button>
                    </div>
                    <div className="timezone-controls" aria-label="Manage timezone clocks">
                        <select
                            value={clockZoneToAdd}
                            onChange={(event) => setClockZoneToAdd(event.target.value)}
                            disabled={availableClockZoneOptions.length === 0}
                        >
                            {availableClockZoneOptions.length === 0 ? (
                                <option value="">All available zones added</option>
                            ) : (
                                availableClockZoneOptions.map((zone) => (
                                    <option key={zone.timeZone} value={zone.timeZone}>
                                        Add {zone.label}
                                    </option>
                                ))
                            )}
                        </select>
                        <button
                            type="button"
                            onClick={handleAddClockZone}
                            disabled={availableClockZoneOptions.length === 0}
                        >
                            Add clock
                        </button>
                        <button
                            type="button"
                            className="timezone-reset"
                            onClick={handleResetClockZones}
                            disabled={isClockZoneSelectionDefault}
                        >
                            Reset
                        </button>
                    </div>
                </aside>
            </header>

            {!isSupabaseConfigured ? (
                <p className="notice notice-warn">
                    The app is running without Supabase configuration, so tasks stay local to the interface until environment variables are provided.
                </p>
            ) : null}

            {isSupabaseConfigured && !isAuthReady ? (
                <p className="notice notice-warn">
                    Creating your guest account session...
                </p>
            ) : null}

            {hasDescriptionColumn === false ? (
                <p className="notice notice-warn">
                    Descriptions are disabled for this Supabase table until the <strong>description</strong> column is added to <strong>public.tasks</strong>.
                </p>
            ) : null}

            <section className="composer" aria-label="Create task">
                <div className="composer-heading">
                    <div>
                        <h2>Quick add task</h2>
                        <p>Drop in a task, give it a short description, and assign a lane.</p>
                    </div>
                </div>
                <section className="team-panel" aria-label="Team members">
                    <div className="team-panel-header">
                        <h3>Team Members</h3>
                        <span>{teamMembers.length} members</span>
                    </div>
                    <form className="team-member-form" onSubmit={handleAddMember}>
                        <input
                            type="text"
                            name="name"
                            placeholder="Member name"
                            value={memberForm.name}
                            onChange={handleMemberFormChange}
                        />
                        <input
                            type="text"
                            name="avatar"
                            placeholder="Avatar text (optional)"
                            value={memberForm.avatar}
                            onChange={handleMemberFormChange}
                        />
                        <div className="color-palette">
                            {PRESET_COLORS.map((color) => (
                                <button
                                    key={color.hex}
                                    type="button"
                                    className={`color-swatch ${memberForm.color === color.hex ? 'active' : ''}`}
                                    style={{ backgroundColor: color.hex }}
                                    onClick={() => setMemberForm((prev) => ({ ...prev, color: color.hex }))}
                                    title={color.label}
                                    aria-label={`${color.label} color`}
                                />
                            ))}
                        </div>
                        <button type="submit">Add Member</button>
                    </form>
                    {teamMembers.length === 0 ? (
                        <p className="team-empty">No team members yet. Add people to start assigning tasks.</p>
                    ) : (
                        <div className="team-list">
                            {teamMembers.map((member) => (
                                <div key={member.id} className="team-member-chip">
                                    <span className="member-avatar" style={{ backgroundColor: member.color }}>
                                        {member.avatar || member.name.slice(0, 1).toUpperCase()}
                                    </span>
                                    <span>{member.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
                <form onSubmit={handleCreateTask} className="composer-form">
                    <input
                        type="text"
                        name="title"
                        placeholder="Task title"
                        value={form.title}
                        onChange={handleChange}
                    />
                    <textarea
                        name="description"
                        placeholder="Task description (optional)"
                        value={form.description}
                        onChange={handleChange}
                        rows={3}
                    />
                    <div className="composer-row">
                        <select name="priority" value={form.priority} onChange={handleChange}>
                            <option value="low">Priority: Low</option>
                            <option value="medium">Priority: Medium</option>
                            <option value="high">Priority: High</option>
                        </select>
                        <input
                            type="date"
                            name="dueDate"
                            value={form.dueDate}
                            onChange={handleChange}
                            aria-label="Due date"
                        />
                    </div>
                    <div className="composer-row">
                        <select name="status" value={form.status} onChange={handleChange}>
                            <option value="todo">To Do</option>
                            <option value="in_progress">In Progress</option>
                            <option value="in_review">In Review</option>
                            <option value="done">Done</option>
                        </select>
                        <button type="submit" disabled={isSaving}>
                            {isSaving ? 'Saving...' : 'Create Task'}
                        </button>
                    </div>
                    <fieldset className="assignee-picker">
                        <legend>Assignees</legend>
                        {teamMembers.length === 0 ? (
                            <p className="team-empty">Add team members above to assign this task.</p>
                        ) : (
                            <div className="assignee-options">
                                {teamMembers.map((member) => (
                                    <label key={member.id} className="assignee-option">
                                        <input
                                            type="checkbox"
                                            checked={form.assigneeIds.includes(member.id)}
                                            onChange={() => handleToggleAssignee(member.id)}
                                        />
                                        <span className="member-avatar" style={{ backgroundColor: member.color }}>
                                            {member.avatar || member.name.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span>{member.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </fieldset>
                </form>
            </section>

            {isBusy ? (
                <div className="status-banner status-loading" role="status" aria-live="polite">
                    <span className="status-spinner" aria-hidden="true" />
                    <span>{isSaving ? 'Creating task...' : 'Loading tasks...'}</span>
                </div>
            ) : null}

            {errorMessage ? (
                <p className="notice notice-error notice-emphasis" role="alert" aria-live="assertive">
                    <strong>Error:</strong> {errorMessage}
                </p>
            ) : null}

            {loadError ? (
                <div className="load-error-group">
                    <p className="notice notice-error notice-emphasis" role="alert" aria-live="assertive">
                        <strong>Unable to load tasks:</strong> {loadError}
                    </p>
                    <button className="retry-button" type="button" onClick={loadTasks} disabled={isLoading}>
                        {isLoading ? 'Retrying...' : 'Retry Loading Tasks'}
                    </button>
                </div>
            ) : null}

            {selectedTaskCount > 0 ? (
                <section className="bulk-toolbar" aria-label="Bulk task actions">
                    <p>
                        <strong>{selectedTaskCount}</strong> task{selectedTaskCount > 1 ? 's' : ''} selected
                    </p>
                    <div className="bulk-toolbar-controls">
                        <select
                            value={bulkTargetStatus}
                            onChange={(event) => setBulkTargetStatus(event.target.value as TaskStatus)}
                            aria-label="Move selected tasks to status"
                        >
                            <option value="todo">Move: To Do</option>
                            <option value="in_progress">Move: In Progress</option>
                            <option value="in_review">Move: In Review</option>
                            <option value="done">Move: Done</option>
                        </select>
                        <button type="button" onClick={handleBulkMoveSelected} disabled={isBusy}>
                            Move selected
                        </button>

                        <select
                            value={bulkTargetPriority}
                            onChange={(event) => setBulkTargetPriority(event.target.value as TaskPriority)}
                            aria-label="Set selected tasks priority"
                        >
                            <option value="low">Priority: Low</option>
                            <option value="medium">Priority: Medium</option>
                            <option value="high">Priority: High</option>
                        </select>
                        <button type="button" onClick={handleBulkPriorityUpdate} disabled={isBusy}>
                            Set priority
                        </button>

                        <button
                            type="button"
                            className="bulk-delete"
                            onClick={handleBulkDeleteSelected}
                            disabled={isBusy}
                        >
                            Delete selected
                        </button>
                        <button type="button" className="bulk-clear" onClick={() => setSelectedTaskIds(new Set())}>
                            Clear selection
                        </button>
                    </div>
                </section>
            ) : null}

            <section className="search-filter-panel" aria-label="Search and filter tasks">
                <div className="search-box">
                    <input
                        type="text"
                        placeholder="Search tasks by title..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        aria-label="Search tasks"
                    />
                </div>

                <div className="filter-group">
                    <div className="filter-section">
                        <label className="filter-label">Priority:</label>
                        <div className="filter-buttons">
                            {(['all', 'low', 'medium', 'high'] as const).map((priority) => (
                                <button
                                    key={priority}
                                    type="button"
                                    className={`filter-btn priority-filter ${selectedPriority === priority ? 'active' : ''}`}
                                    onClick={() => setSelectedPriority(priority === 'all' ? 'all' : priority)}
                                >
                                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="filter-section">
                        <label className="filter-label">Assignee:</label>
                        <div className="filter-buttons">
                            <button
                                type="button"
                                className={`filter-btn assignee-filter ${selectedAssignee === 'all' ? 'active' : ''}`}
                                onClick={() => setSelectedAssignee('all')}
                            >
                                All
                            </button>
                            {teamMembers.map((member) => (
                                <button
                                    key={member.id}
                                    type="button"
                                    className={`filter-btn assignee-filter ${selectedAssignee === member.id ? 'active' : ''}`}
                                    onClick={() => setSelectedAssignee(member.id)}
                                    title={member.name}
                                >
                                    <span className="member-avatar" style={{ backgroundColor: member.color }}>
                                        {member.avatar || member.name.slice(0, 1).toUpperCase()}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="board-grid" aria-label="Kanban columns">
                <Column
                    status="todo"
                    title="To Do"
                    tasks={tasksByStatus.todo}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelection={handleToggleSelection}
                    onDropTask={handleTaskDrop}
                    onColumnDragEnter={handleColumnDragEnter}
                    onTaskDragStart={handleTaskDragStart}
                    onTaskDragEnd={handleTaskDragEnd}
                    onMoveTask={moveTaskToStatus}
                    onTaskClick={handleTaskClick}
                    teamMembers={teamMembers}
                    isDropTarget={dragOverStatus === 'todo'}
                    onDeleteSelected={() => handleDeleteSelectedInColumn('todo')}
                    onClearAll={() => handleClearAllInColumn('todo')}
                    isDeleting={deletingStatus === 'todo'}
                    isClearing={clearingStatus === 'todo'}
                />
                <Column
                    status="in_progress"
                    title="In Progress"
                    tasks={tasksByStatus.in_progress}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelection={handleToggleSelection}
                    onDropTask={handleTaskDrop}
                    onColumnDragEnter={handleColumnDragEnter}
                    onTaskDragStart={handleTaskDragStart}
                    onTaskDragEnd={handleTaskDragEnd}
                    onMoveTask={moveTaskToStatus}
                    onTaskClick={handleTaskClick}
                    teamMembers={teamMembers}
                    isDropTarget={dragOverStatus === 'in_progress'}
                    onDeleteSelected={() => handleDeleteSelectedInColumn('in_progress')}
                    onClearAll={() => handleClearAllInColumn('in_progress')}
                    isDeleting={deletingStatus === 'in_progress'}
                    isClearing={clearingStatus === 'in_progress'}
                />
                <Column
                    status="in_review"
                    title="In Review"
                    tasks={tasksByStatus.in_review}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelection={handleToggleSelection}
                    onDropTask={handleTaskDrop}
                    onColumnDragEnter={handleColumnDragEnter}
                    onTaskDragStart={handleTaskDragStart}
                    onTaskDragEnd={handleTaskDragEnd}
                    onMoveTask={moveTaskToStatus}
                    onTaskClick={handleTaskClick}
                    teamMembers={teamMembers}
                    isDropTarget={dragOverStatus === 'in_review'}
                    onDeleteSelected={() => handleDeleteSelectedInColumn('in_review')}
                    onClearAll={() => handleClearAllInColumn('in_review')}
                    isDeleting={deletingStatus === 'in_review'}
                    isClearing={clearingStatus === 'in_review'}
                />
                <Column
                    status="done"
                    title="Done"
                    tasks={tasksByStatus.done}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelection={handleToggleSelection}
                    onDropTask={handleTaskDrop}
                    onColumnDragEnter={handleColumnDragEnter}
                    onTaskDragStart={handleTaskDragStart}
                    onTaskDragEnd={handleTaskDragEnd}
                    onMoveTask={moveTaskToStatus}
                    onTaskClick={handleTaskClick}
                    teamMembers={teamMembers}
                    isDropTarget={dragOverStatus === 'done'}
                    onDeleteSelected={() => handleDeleteSelectedInColumn('done')}
                    onClearAll={() => handleClearAllInColumn('done')}
                    isDeleting={deletingStatus === 'done'}
                    isClearing={clearingStatus === 'done'}
                />
            </section>

            <TaskDetail
                task={selectedTask}
                teamMembers={teamMembers}
                onUpdateTask={handleUpdateTask}
                onClose={() => setSelectedTask(null)}
            />

            {undoSnapshot ? (
                <div className="undo-toast" role="status" aria-live="polite">
                    <span>{undoSnapshot.message}</span>
                    <div className="undo-toast-actions">
                        <button type="button" onClick={handleUndoLastAction}>
                            Undo
                        </button>
                        <button type="button" onClick={clearUndoSnapshot} className="undo-dismiss">
                            Dismiss
                        </button>
                    </div>
                </div>
            ) : null}
        </main>
    )
}

export default Board
