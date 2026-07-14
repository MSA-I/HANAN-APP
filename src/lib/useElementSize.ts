import { useEffect, useRef, useState } from 'react'

export function useElementSize<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>
  width: number
  height: number
} {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, ...size }
}
