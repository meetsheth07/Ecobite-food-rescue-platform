import { create } from 'zustand'

export const useSession = create((set) => ({
  user: null,
  hydrated: false,
  setUser: (user) => set({ user, hydrated: true }),
  clearUser: () => set({ user: null, hydrated: true }),
}))
