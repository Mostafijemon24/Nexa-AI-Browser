export function passwordStrength(pw: string) {
  if (!pw) return { label: '—', score: 0, color: 'var(--text-3)' }
  let classes = 0
  if (/[a-z]/.test(pw)) classes++
  if (/[A-Z]/.test(pw)) classes++
  if (/[0-9]/.test(pw)) classes++
  if (/[^a-zA-Z0-9]/.test(pw)) classes++
  const bits = pw.length * (classes <= 1 ? 2 : classes === 2 ? 3 : classes === 3 ? 4 : 5)
  if (bits < 28) return { label: 'Very weak', score: Math.min(100, bits), color: 'var(--error)' }
  if (bits < 44) return { label: 'Weak', score: Math.min(100, bits), color: 'var(--error)' }
  if (bits < 64) return { label: 'Fair', score: Math.min(100, bits), color: 'var(--warning)' }
  if (bits < 90) return { label: 'Strong', score: Math.min(100, bits), color: 'var(--success)' }
  return { label: 'Very strong', score: Math.min(100, bits), color: 'var(--success)' }
}
