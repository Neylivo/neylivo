import { createClient } from '@supabase/supabase-js'
import { authStorage } from './authStore'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  console.warn('Supabase env не задан — заполни .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)')
}

// v1.442.0: вход переживает обновление приложения.
//
// Хранилище с двумя опорами (см. lib/authStore.ts): localStorage плюс запасная
// нативная полка на Android. Раньше сессия лежала только в localStorage, а на
// телефоне он переживает не всякое обновление — со стороны это выглядело как
// «после обновления выкинуло из аккаунта».
export const supabase = createClient(url, anon, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Разбор ссылки нужен только в браузере при возврате из письма; в
    // приложении он лишний и на некоторых адресах мешает.
    detectSessionInUrl: true,
  },
})
