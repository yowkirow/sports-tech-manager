import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App.jsx'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource/barlow-condensed/latin-800-italic.css'
import './index.css'

import { ToastProvider } from './components/ui/Toast';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div role="alert" className="min-h-dvh flex flex-col items-center justify-center gap-5 bg-ground p-6 text-center text-ink">
                    <img src="/logo.png" alt="SportsTech" className="h-16 w-auto" />
                    <h1 className="display text-4xl">Unable to open this screen</h1>
                    <p className="max-w-md text-ink-2">Check your connection, then reload SportsTech. Unsaved changes may be lost.</p>
                    <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Reload SportsTech</button>
                </div>
            );
        }

        return this.props.children;
    }
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <MotionConfig reducedMotion="user">
                <ToastProvider>
                    <App />
                </ToastProvider>
            </MotionConfig>
        </ErrorBoundary>
    </React.StrictMode>,
)
