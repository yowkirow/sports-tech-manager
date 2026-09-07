import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
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
                <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-slate-100">
                    <h1 className="text-xl font-bold">Unable to open this screen</h1>
                    <p className="max-w-md text-slate-300">Check your connection, then reload SportsTech. Unsaved changes may be lost.</p>
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
            <ToastProvider>
                <App />
            </ToastProvider>
        </ErrorBoundary>
    </React.StrictMode>,
)
