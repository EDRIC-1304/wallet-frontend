import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import './appln.css';
import EscrowJson from './Escrow.json';

// --- Constants ---
const API_BASE_URL = 'https://wallet-backend-quy1.onrender.com/api';
const USDT_CONTRACT_ADDRESS = '0x787A697324dbA4AB965C58CD33c13ff5eeA6295F';
const USDC_CONTRACT_ADDRESS = '0x342e3aA1248AB77E319e3331C6fD3f1F2d4B36B1';
const TOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint amount) returns (bool)",
    "function transfer(address to, uint amount) returns (bool)"
];
const ESCROW_ABI = EscrowJson.abi;
const ESCROW_BYTECODE = EscrowJson.bytecode;

// --- Helper Functions ---
const shortAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

// --- NEW: API Utility with JWT ---
// Helper to automatically add our auth token to every request
const api = {
    get: (endpoint) => fetch(`${API_BASE_URL}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    }),
    post: (endpoint, body) => fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify(body)
    }),
    put: (endpoint, body) => fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify(body)
    }),
};

function Appln() {
    // --- State Management ---
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [account, setAccount] = useState(null);
    const [bnb, setBnb] = useState('0');
    const [usdt, setUsdt] = useState('0');
    const [usdc, setUsdc] = useState('0');
    const [agreements, setAgreements] = useState([]);
    const [formState, setFormState] = useState({ arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
    const [uiMessage, setUiMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // --- NEW: Authentication State ---
    const [authState, setAuthState] = useState('LOGGED_OUT'); // LOGGED_OUT, REGISTERING, LOGGED_IN
    const [authForm, setAuthForm] = useState({ identifier: '', password: '', username: '' });
    const [registrationAddress, setRegistrationAddress] = useState(null);

    // --- Data Fetching & Callbacks ---
    const fetchAgreements = useCallback(async () => {
        if (!localStorage.getItem('authToken')) return;
        try {
            const response = await api.get('/agreements'); // Uses JWT
            if (!response.ok) {
                if (response.status === 401) logout();
                throw new Error("Failed to fetch agreements from the server.");
            }
            const data = await response.json();
            setAgreements(data);
        } catch (error) {
            console.error(error);
            setUiMessage(`Error: Could not fetch agreements.`);
        }
    }, []);
    
    const updateBalances = useCallback(async (currentAccount) => {
        // This function requires a live provider, so we'll set it up after login
        if (!currentAccount) return;
        try {
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            setProvider(newProvider); // Set provider here
            
            const bnbBalance = await newProvider.getBalance(currentAccount);
            setBnb(ethers.formatEther(bnbBalance));
            const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, TOKEN_ABI, newProvider);
            const usdtBalance = await usdtContract.balanceOf(currentAccount);
            setUsdt(ethers.formatUnits(usdtBalance, 18));
            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, TOKEN_ABI, newProvider);
            const usdcBalance = await usdcContract.balanceOf(currentAccount);
            setUsdc(ethers.formatUnits(usdcBalance, 18));
        } catch (error) {
            console.error("Failed to update balances:", error);
            // Don't show UI error for this, it's a background task
        }
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('authToken');
        setAccount(null);
        setProvider(null);
        setSigner(null);
        setAuthState('LOGGED_OUT');
        setAgreements([]);
        setAuthForm({ identifier: '', password: '', username: '' });
        setUiMessage("You have been successfully logged out.");
    }, []);
    
    // --- NEW: Authentication Handlers ---
    const handleWalletConnect = async () => { /* ... see previous response ... */ };
    const handleRegister = async (e) => { /* ... see previous response ... */ };
    const handleLogin = async (e) => { /* ... see previous response ... */ };

    // --- Use Effects ---
    useEffect(() => { /* ... handleAccountsChanged from previous response (optional with JWT)... */ });
    
    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (token) {
            try {
                const decodedToken = JSON.parse(atob(token.split('.')[1]));
                if (decodedToken.exp * 1000 < Date.now()) {
                    logout();
                } else {
                    setAccount(decodedToken.address);
                    setAuthState('LOGGED_IN');
                }
            } catch { logout(); }
        }
    }, [logout]);

    useEffect(() => {
        if (authState === 'LOGGED_IN' && account) {
            updateBalances(account);
            fetchAgreements();
            // Set up signer if MetaMask is available
            if (typeof window.ethereum !== "undefined") {
                const newProvider = new ethers.BrowserProvider(window.ethereum);
                newProvider.getSigner().then(setSigner);
            }
        }
    }, [authState, account, updateBalances, fetchAgreements]);

    // --- Escrow Core Functions (Updated to use JWT) ---
    const createAgreement = async () => {
        if (!signer || !account) return setUiMessage("Please connect wallet and sign in first.");
        // ... rest of your function is the same, but the POST request uses the `api` helper
        const response = await api.post('/agreements', { /* body */ });
    };

    const handleAction = async (agreement, action) => {
        if (!signer) return setUiMessage("Signer not found. Please reconnect wallet.");
        // ... rest of your function is the same, but the PUT request uses the `api` helper
        const response = await api.put(`/agreements/${agreement.contractAddress}/status`, { status: newStatus });
    };


    // --- RENDER LOGIC ---
    if (authState !== 'LOGGED_IN') {
        return (
            <div className="auth-container">
                <div className="auth-box">
                    <h1>Escrow DApp</h1>
                    {uiMessage && <p className="ui-message">{uiMessage}</p>}

                    {authState === 'LOGGED_OUT' && ( /* ... JSX from previous response ... */ )}
                    {authState === 'REGISTERING' && ( /* ... JSX from previous response ... */ )}
                </div>
            </div>
        );
    }
    
    // YOUR MAIN DASHBOARD - REMAINS IDENTICAL
    return (
        <div className="main-container">
            <header className="main-header">
                <h2>Escrow Dashboard</h2>
                <div className="header-right">
                    <p>Connected: {shortAddress(account)}</p>
                    <button onClick={logout} className="btn-logout">Logout</button>
                </div>
            </header>
            <div className="content-grid">
                <div className="column-left">
                    <div className="card">
                        <h3>Your Balances</h3>
                        <div className="balance-list">
                            <p><strong>BNB:</strong> {parseFloat(bnb).toFixed(4)}</p>
                            <p><strong>USDT:</strong> {parseFloat(usdt).toFixed(2)}</p>
                            <p><strong>USDC:</strong> {parseFloat(usdc).toFixed(2)}</p>
                        </div>
                    </div>
                    <div className="card">
                        <h3>Create New Escrow</h3>
                        <div className="form-group">
                            <input placeholder="Arbiter Address" value={formState.arbiter} onChange={(e) => setFormState({...formState, arbiter: e.target.value})} />
                            <input placeholder="Beneficiary Address (Recipient)" value={formState.beneficiary} onChange={(e) => setFormState({...formState, beneficiary: e.target.value})} />
                            <div className="amount-input-group">
                                <input type="number" placeholder="Amount" value={formState.amount} onChange={(e) => setFormState({...formState, amount: e.target.value})} />
                                <select value={formState.token} onChange={(e) => setFormState({...formState, token: e.target.value})}>
                                    <option value="USDT">USDT</option>
                                    <option value="USDC">USDC</option>
                                </select>
                            </div>
                            <button onClick={createAgreement} disabled={isLoading}>Create Agreement</button>
                        </div>
                    </div>
                </div>
                <div className="column-right">
                    <div className="card">
                        <h3>Your Agreements</h3>
                        {uiMessage && <p className="ui-message-inline">{uiMessage}</p>}
                        <div className="agreements-list">
                            {agreements.length === 0 ? <p>No agreements found for your address. Create one to get started!</p> :
                                agreements.map(agg => (
                                    <div key={agg.contractAddress} className="agreement-item">
                                        {/* ... Your existing agreement item JSX ... */}
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Appln;