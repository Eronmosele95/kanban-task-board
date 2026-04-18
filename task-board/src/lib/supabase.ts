import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

type GuestSessionResult = {
    userId: string | null
    error: string | null
}

export const ensureGuestSession = async (): Promise<GuestSessionResult> => {
    if (!supabase) {
        return {
            userId: null,
            error: 'Supabase is not configured.',
        }
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

    if (sessionError) {
        return {
            userId: null,
            error: sessionError.message,
        }
    }

    const existingUserId = sessionData.session?.user?.id
    if (existingUserId) {
        return {
            userId: existingUserId,
            error: null,
        }
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously()

    if (signInError) {
        return {
            userId: null,
            error: signInError.message,
        }
    }

    const signedInUserId = signInData.user?.id ?? signInData.session?.user?.id ?? null

    if (!signedInUserId) {
        return {
            userId: null,
            error: 'Guest session was created, but no user id was returned.',
        }
    }

    return {
        userId: signedInUserId,
        error: null,
    }
}
