import { createContext, useContext } from 'react';

export const ReadOnlyContext = createContext(false);

/** True when the workspace is a read-only snapshot (staging or maintenance); disable every control that would save. */
export const useReadOnly = () => useContext(ReadOnlyContext);

export const READ_ONLY_HINT = 'Read-only snapshot: saving is disabled';
