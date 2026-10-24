import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

export function getApiError(error) {
  return error.response?.data?.message || error.message || 'Something went wrong. Please try again.'
}

export default api
