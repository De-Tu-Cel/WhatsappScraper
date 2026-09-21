'use client'
import { createContext, useContext, useState, useCallback } from 'react'

const NavigationCtx = createContext(null)
export const useNavigation = () => useContext(NavigationCtx)

export function NavigationProvider({ children }) {
  const [pendingConvId, setPendingConvId] = useState(null)
  const [pendingConvNumber, setPendingConvNumber] = useState(null)
  const clearPendingConv = useCallback(() => { setPendingConvId(null); setPendingConvNumber(null) }, [])

  return (
    <NavigationCtx.Provider value={{ pendingConvId, setPendingConvId, pendingConvNumber, setPendingConvNumber, clearPendingConv }}>
      {children}
    </NavigationCtx.Provider>
  )
}
