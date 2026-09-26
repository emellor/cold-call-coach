import { createContext, useContext } from 'react';

export interface Auth {
  /** This deploy has a password (APP_PASSWORD), so there is a session to end. */
  required: boolean;
  signOut: () => void;
}

export const AuthContext = createContext<Auth>({ required: false, signOut: () => {} });

export const useAuth = (): Auth => useContext(AuthContext);
