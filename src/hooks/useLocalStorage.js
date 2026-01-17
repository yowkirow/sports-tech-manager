import { useState, useEffect } from 'react';

const useLocalStorage = (key, initialValue) => {
    // Get from local storage then use the initialValue if not found
    const [value, setValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    // Return a wrapped version of useState's setter function that ...
    // ... persists the new value to localStorage.
    const setStoredValue = (valueToStore) => {
        try {
            // Allow value to be a function so we have same API as useState
            const valueToStoreFn =
                valueToStore instanceof Function ? valueToStore(value) : valueToStore;

            setValue(valueToStoreFn);

            window.localStorage.setItem(key, JSON.stringify(valueToStoreFn));
        } catch (error) {
            console.error(error);
        }
    };

    return [value, setStoredValue];
};

export default useLocalStorage;
