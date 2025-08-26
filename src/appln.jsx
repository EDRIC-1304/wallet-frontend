import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { motion, AnimatePresence } from 'framer-motion';
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

// --- API Utility with JWT (Corrected) ---
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


// --- Motion Variants ---
const variants = {
    backdrop: {
        hidden: { opacity: 0 },
        visible: { opacity: 1 },
    },
    modal: {
        hidden: { y: "100vh", opacity: 0 },
        visible: { y: "0", opacity: 1, transition: { duration: 0.5, type: "spring", damping: 25, stiffness: 500 } },
        exit: { y: "100vh", opacity: 0 },
    },
    card: {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
    },
    list: {
        visible: { transition: { staggerChildren: 0.1 } }
    },
    item: {
        hidden: { opacity: 0, y: 15, scale: 0.98 },
        visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3 } }
    },
};

// --- Reusable UI Components ---

const AgreementTimer = ({ deadline, status }) => {
    const calculateTimeLeft = useCallback(() => {
        const difference = new Date(deadline) - new Date();
        if (difference > 0) {
            const totalSeconds = Math.floor(difference / 1000);
            return {
                minutes: Math.floor((totalSeconds / 60) % 60),
                seconds: Math.floor(totalSeconds % 60),
            };
        }
        return null;
    }, [deadline]);

    const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

    useEffect(() => {
        if (status !== 'Created' || !deadline) return;
        const timer = setInterval(() => {
            const newTimeLeft = calculateTimeLeft();
            if (newTimeLeft) {
                setTimeLeft(newTimeLeft);
            } else {
                setTimeLeft(null);
                clearInterval(timer);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [status, deadline, calculateTimeLeft]);

    if (status !== 'Created' || !timeLeft) return null;

    const timerText = `${String(timeLeft.minutes).padStart(2, '0')}:${String(timeLeft.seconds).padStart(2, '0')}`;
    const isEnding = timeLeft.minutes < 1;

    return (
        <div className={`timer ${isEnding ? 'ending' : ''}`}>
            <span className="timer-icon">⏳</span>
            <span>Time to Fund:</span>
            <span className="timer-text">{timerText}</span>
        </div>
    );
};

const InlineSpinner = ({ text }) => (
    <div className="inline-spinner-container">
        <span className="spinner" />
        {text && <span>{text}</span>}
    </div>
);

const PageOverlayLoader = ({ show, text = "Processing..." }) => (
    <AnimatePresence>
        {show && (
            <motion.div className="overlay-loader" variants={variants.backdrop} initial="hidden" animate="visible" exit="hidden">
                <motion.div className="overlay-card" variants={variants.modal}>
                    <span className="spinner big" />
                    <p>{text}</p>
                </motion.div>
            </motion.div>
        )}
    </AnimatePresence>
);

const Toast = ({ message, type, onClose }) => {
    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(() => onClose?.(), 5000);
        return () => clearTimeout(timer);
    }, [message, onClose]);

    return (
        <AnimatePresence>
            {message && (
                <motion.div
                    className={`toast toast-${type}`}
                    initial={{ y: 50, opacity: 0, scale: 0.9 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: 50, opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                >
                    <div className="toast-icon">
                        {type === 'success' && '✓'}
                        {type === 'error' && '✕'}
                        {type === 'info' && 'i'}
                    </div>
                    <div className="toast-content">{message}</div>
                    <button onClick={onClose} className="toast-close">✕</button>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// --- Main Application Component ---

function Appln() {
    // --- State Management ---
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [account, setAccount] = useState(null);
    const [balances, setBalances] = useState({ bnb: '0', usdt: '0', usdc: '0' });
    const [agreements, setAgreements] = useState([]);
    const [formState, setFormState] = useState({ depositor: '', arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
    
    const [uiState, setUiState] = useState({ message: '', type: 'info' }); // type: 'info', 'success', 'error'
    const [loadingState, setLoadingState] = useState({
        global: false,
        balances: false,
        agreements: false,
        auth: false,
        action: null, // e.g., 'Fund-0x123...'
    });

    const [myRole, setMyRole] = useState('depositor');
    const [authState, setAuthState] = useState('INIT'); // INIT, LOGGED_OUT, REGISTERING, LOGGING_IN, LOGGED_IN
    const [authForm, setAuthForm] = useState({ identifier: '', password: '', username: '' });
    const [registrationAddress, setRegistrationAddress] = useState(null);

    // --- Helper to set UI messages ---
    const showMessage = (message, type = 'info', duration = 5000) => {
        setUiState({ message, type });
    };
    
    const clearMessage = useCallback(() => setUiState({ message: '', type: 'info' }), []);

    // --- Logout Function ---
    const logout = useCallback(() => {
        localStorage.removeItem('authToken');
        setAccount(null);
        setProvider(null);
        setSigner(null);
        setAgreements([]);
        setBalances({ bnb: '0', usdt: '0', usdc: '0' });
        setAuthForm({ identifier: '', password: '', username: '' });
        setAuthState('LOGGED_OUT');
        showMessage("You have been successfully logged out.", "success");
    }, []);

    // --- Data Fetching ---
    const fetchAgreements = useCallback(async () => {
        if (!localStorage.getItem('authToken')) return;
        setLoadingState(s => ({ ...s, agreements: true }));
        try {
            const response = await api.get('/agreements');
            if (!response.ok) {
                if (response.status === 401) logout();
                throw new Error("Session expired or invalid.");
            }
            const data = await response.json();
            setAgreements(data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        } catch (error) {
            console.error(error);
            showMessage(`Error: Could not fetch agreements.`, "error");
        } finally {
            setLoadingState(s => ({ ...s, agreements: false }));
        }
    }, [logout]);

    const updateBalances = useCallback(async (currentAccount, currentProvider) => {
        if (!currentAccount || !currentProvider) return;
        setLoadingState(s => ({ ...s, balances: true }));
        try {
            const bnbBalance = await currentProvider.getBalance(currentAccount);
            const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            const usdtBalance = await usdtContract.balanceOf(currentAccount);
            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            const usdcBalance = await usdcContract.balanceOf(currentAccount);
            
            setBalances({
                bnb: ethers.formatEther(bnbBalance),
                usdt: ethers.formatUnits(usdtBalance, 18),
                usdc: ethers.formatUnits(usdcBalance, 18),
            });
        } catch (error) {
            console.error("Failed to update balances:", error);
            showMessage("Could not refresh balances.", "error");
        } finally {
            setLoadingState(s => ({ ...s, balances: false }));
        }
    }, []);

    // --- Authentication ---
    const handleWalletConnect = async () => {
        if (typeof window.ethereum === "undefined") {
            return showMessage("MetaMask not detected. Please install it.", "error");
        }
        setLoadingState(s => ({ ...s, auth: true }));
        showMessage("Connecting to wallet...", "info");
        try {
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await newProvider.send("eth_requestAccounts", []);
            const currentAddress = ethers.getAddress(accounts);

            const checkResponse = await fetch(`${API_BASE_URL}/auth/check-user/${currentAddress}`);
            const { isRegistered } = await checkResponse.json();

            if (isRegistered) {
                showMessage('Account found. Please log in.', "success");
                setAuthState('LOGGING_IN');
                setAuthForm({ ...authForm, identifier: currentAddress, password: '' });
            } else {
                showMessage('New wallet detected. Sign message to register.', "info");
                const newSigner = await newProvider.getSigner();
                await newSigner.signMessage(`Register for Escrow DApp: ${currentAddress}`);
                setRegistrationAddress(currentAddress);
                setAuthState('REGISTERING');
                showMessage('Signature verified! Create a password.', "success");
            }
        } catch (error) {
            showMessage(error.message || 'Connection or signature failed.', "error");
            setAuthState('LOGGED_OUT');
        } finally {
            setLoadingState(s => ({ ...s, auth: false }));
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!authForm.password) return showMessage("Password is required.", "error");
        setLoadingState(s => ({ ...s, auth: true }));
        showMessage("Creating your account...", "info");
        try {
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: registrationAddress,
                    password: authForm.password,
                    username: authForm.username || undefined,
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            localStorage.setItem('authToken', data.token);
            setAccount(registrationAddress);
            setAuthState('LOGGED_IN');
            showMessage(`Welcome, ${authForm.username || shortAddress(registrationAddress)}!`, "success");
        } catch (error) {
            showMessage(`Registration failed: ${error.message}`, "error");
        } finally {
            setLoadingState(s => ({ ...s, auth: false }));
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoadingState(s => ({ ...s, auth: true }));
        showMessage("Logging in...", "info");
        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    identifier: authForm.identifier,
                    password: authForm.password,
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            const decodedToken = JSON.parse(atob(data.token.split('.')));
            setAccount(decodedToken.address);
            localStorage.setItem('authToken', data.token);
            setAuthState('LOGGED_IN');
            showMessage('Login successful!', "success");
        } catch (error) {
            showMessage(`Login failed: ${error.message}`, "error");
        } finally {
            setLoadingState(s => ({ ...s, auth: false }));
        }
    };

    // --- Escrow Core Functions ---
    const createAgreement = async () => {
        if (!signer || !account) return showMessage("Please connect wallet and sign in first.", "error");
        const { depositor, arbiter, beneficiary, amount, token } = formState;
        if (!ethers.isAddress(depositor) || !ethers.isAddress(arbiter) || !ethers.isAddress(beneficiary) || !amount || parseFloat(amount) <= 0) {
            return showMessage("Please fill all fields with valid addresses and a positive amount.", "error");
        }

        setLoadingState(s => ({ ...s, global: true, action: 'create' }));
        showMessage("Deploying new escrow contract...", "info");
        try {
            const tokenAddress = token === 'USDT' ? USDT_CONTRACT_ADDRESS : USDC_CONTRACT_ADDRESS;
            const value = ethers.parseUnits(amount, 18);

            const EscrowFactory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, signer);
            const escrowContract = await EscrowFactory.deploy(arbiter, beneficiary, depositor, tokenAddress, value);
            await escrowContract.waitForDeployment();
            const contractAddress = await escrowContract.getAddress();
            
            showMessage(`Contract deployed. Saving to database...`, "info");
            
            const response = await api.post('/agreements', { contractAddress, depositor, arbiter, beneficiary, amount, token, tokenAddress });
            if (!response.ok) throw new Error((await response.json()).error || "Failed to save agreement.");

            showMessage("Agreement created successfully!", "success");
            setFormState({ depositor: '', arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
            setMyRole('depositor');
            fetchAgreements();
        } catch (error) {
            showMessage(`Error: ${error.reason || error.message}`, "error");
        } finally {
            setLoadingState(s => ({ ...s, global: false, action: null }));
        }
    };

    const handleAction = async (agreement, action) => {
        if (!signer) return showMessage("Signer not found.", "error");
        
        const actionKey = `${action}-${agreement.contractAddress}`;
        setLoadingState(s => ({ ...s, action: actionKey }));
        showMessage(`Processing: ${action}...`, "info");

        try {
            const escrowContract = new ethers.Contract(agreement.contractAddress, ESCROW_ABI, signer);
            let tx;

            if (action === "Fund") {
                const tokenContract = new ethers.Contract(agreement.tokenAddress, TOKEN_ABI, signer);
                const value = ethers.parseUnits(agreement.amount, 18);
                showMessage("Checking token approval...", "info");
                const allowance = await tokenContract.allowance(account, agreement.contractAddress);

                if (allowance < value) {
                    showMessage("Approving token transfer...", "info");
                    const approveTx = await tokenContract.approve(agreement.contractAddress, value);
                    await approveTx.wait();
                    showMessage("Approval confirmed. Funding escrow...", "info");
                }
                tx = await escrowContract.fund();
            } else if (action === "Release") {
                showMessage("Releasing funds...", "info");
                tx = await escrowContract.release();
            } else {
                throw new Error("Invalid action");
            }

            showMessage(`Transaction sent (${shortAddress(tx.hash)}). Waiting...`, "info");
            await tx.wait();

            showMessage("Transaction confirmed! Updating status...", "success");
            const newStatus = action === "Fund" ? "Funded" : "Released";
            const response = await api.put(`/agreements/${agreement.contractAddress}/status`, { status: newStatus });
            if (!response.ok) throw new Error("Failed to update agreement status.");

            showMessage(`Agreement successfully ${newStatus}!`, "success");
            fetchAgreements();
            updateBalances(account, provider);
        } catch (error) {
            showMessage(`Error during ${action}: ${error.reason || error.message}`, "error");
        } finally {
            setLoadingState(s => ({ ...s, action: null }));
        }
    };

    // --- Use Effects ---
    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (token) {
            try {
                const decoded = JSON.parse(atob(token.split('.')));
                if (decoded.exp * 1000 < Date.now()) {
                    logout();
                } else {
                    setAccount(decoded.address);
                    setAuthState('LOGGED_IN');
                }
            } catch { logout(); }
        } else {
            setAuthState('LOGGED_OUT');
        }
    }, [logout]);

    useEffect(() => {
        if (authState === 'LOGGED_IN' && account) {
            if (window.ethereum) {
                const newProvider = new ethers.BrowserProvider(window.ethereum);
                setProvider(newProvider);
                updateBalances(account, newProvider);
                newProvider.getSigner().then(setSigner);
                fetchAgreements();
            }
        }
    }, [authState, account, updateBalances, fetchAgreements]);

    useEffect(() => {
        if (account) {
            setFormState(prev => ({
                ...prev,
                depositor: myRole === 'depositor' ? account : '',
                arbiter: myRole === 'arbiter' ? account : '',
                beneficiary: myRole === 'beneficiary' ? account : '',
            }));
        }
    }, [myRole, account]);

    // --- Render Logic ---

    if (authState === 'INIT') {
        return <div className="loading-screen"></div>; // Or a splash screen
    }

    if (authState !== 'LOGGED_IN') {
        return (
            <div className="auth-container">
                <motion.div className="auth-box" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
                    <motion.h1 layoutId="title-glow">Escrow DApp</motion.h1>
                    <p className="auth-subtitle">Secure, decentralized agreements on the blockchain.</p>
                    
                    <AnimatePresence mode="wait">
                        {authState === 'LOGGED_OUT' && (
                            <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <motion.button
                                    onClick={handleWalletConnect}
                                    className="btn-primary btn-connect"
                                    disabled={loadingState.auth}
                                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                                >
                                    {loadingState.auth ? <InlineSpinner text="Connecting..." /> : "Connect Wallet"}
                                </motion.button>
                                <p className="auth-switch">Already have an account? <button onClick={() => setAuthState('LOGGING_IN')}>Login Here</button></p>
                            </motion.div>
                        )}
                        
                        {authState === 'LOGGING_IN' && (
                             <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="auth-form-container">
                                <form onSubmit={handleLogin} className="auth-form">
                                    <input placeholder="Wallet Address or Username" value={authForm.identifier} onChange={(e) => setAuthForm({ ...authForm, identifier: e.target.value })} required />
                                    <input type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
                                    <motion.button type="submit" className="btn-primary" disabled={loadingState.auth} whileTap={{ scale: 0.98 }}>
                                        {loadingState.auth ? <InlineSpinner text="Logging in..." /> : 'Login'}
                                    </motion.button>
                                </form>
                                <p className="auth-switch">New user? <button onClick={handleWalletConnect}>Register Wallet</button></p>
                            </motion.div>
                        )}

                        {authState === 'REGISTERING' && (
                             <motion.div key="register" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="auth-form-container">
                                <form onSubmit={handleRegister} className="auth-form">
                                    <p>Registering for: <strong>{shortAddress(registrationAddress)}</strong></p>
                                    <input placeholder="Username (Optional)" value={authForm.username} onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} />
                                    <input type="password" placeholder="Create Password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
                                    <motion.button type="submit" className="btn-primary" disabled={loadingState.auth} whileTap={{ scale: 0.98 }}>
                                        {loadingState.auth ? <InlineSpinner text="Creating Account..." /> : 'Create Account'}
                                    </motion.button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
                <Toast message={uiState.message} type={uiState.type} onClose={clearMessage} />
            </div>
        );
    }

    return (
        <div className="main-container">
            <header className="main-header">
                <motion.h2 initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>Escrow Dashboard</motion.h2>
                <div className="header-right">
                    <motion.div className="header-account" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                        <span>{shortAddress(account)}</span>
                    </motion.div>
                    <motion.button onClick={logout} className="btn-logout" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        Logout
                    </motion.button>
                </div>
            </header>

            <div className="content-grid">
                <motion.div className="column-left" variants={variants.list} initial="hidden" animate="visible">
                    <motion.div className="card" variants={variants.card}>
                        <h3>Your Balances</h3>
                        <div className="balance-list">
                            {loadingState.balances ? (
                                Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton-row" />)
                            ) : (
                                <>
                                    <p><span>BNB</span> <strong>{parseFloat(balances.bnb).toFixed(4)}</strong></p>
                                    <p><span>USDT</span> <strong>{parseFloat(balances.usdt).toFixed(2)}</strong></p>
                                    <p><span>USDC</span> <strong>{parseFloat(balances.usdc).toFixed(2)}</strong></p>
                                </>
                            )}
                        </div>
                        <motion.button
                            className="btn-refresh"
                            onClick={() => updateBalances(account, provider)}
                            disabled={loadingState.balances}
                            whileTap={{ scale: 0.97 }}
                        >
                             {loadingState.balances ? <InlineSpinner /> : 'Refresh'}
                        </motion.button>
                    </motion.div>

                    <motion.div className="card" variants={variants.card}>
                        <h3>Create New Escrow</h3>
                        <div className="role-selector">
                            <span>I am the:</span>
                            {['depositor', 'arbiter', 'beneficiary'].map(role => (
                                <motion.button
                                    key={role}
                                    className={myRole === role ? 'active' : ''}
                                    onClick={() => setMyRole(role)}
                                    whileTap={{ scale: 0.98 }}
                                >
                                    {role.charAt(0).toUpperCase() + role.slice(1)}
                                </motion.button>
                            ))}
                        </div>
                        <div className="form-group">
                            {['depositor', 'arbiter', 'beneficiary'].map(role => (
                                <input
                                    key={role}
                                    placeholder={`${role.charAt(0).toUpperCase() + role.slice(1)} Address`}
                                    value={myRole === role ? shortAddress(account) : formState[role]}
                                    onChange={myRole !== role ? (e) => setFormState({ ...formState, [role]: e.target.value }) : undefined}
                                    readOnly={myRole === role}
                                    disabled={myRole === role}
                                />
                            ))}
                            <div className="amount-input-group">
                                <input type="number" placeholder="Amount" value={formState.amount} onChange={(e) => setFormState({ ...formState, amount: e.target.value })} />
                                <select value={formState.token} onChange={(e) => setFormState({ ...formState, token: e.target.value })}>
                                    <option value="USDT">USDT</option>
                                    <option value="USDC">USDC</option>
                                </select>
                            </div>
                            <motion.button onClick={createAgreement} disabled={loadingState.action === 'create'} className="btn-action" whileTap={{ scale: 0.98 }}>
                                {loadingState.action === 'create' ? <InlineSpinner text="Creating..." /> : 'Create Agreement'}
                            </motion.button>
                        </div>
                    </motion.div>
                </motion.div>

                <motion.div className="column-right" variants={variants.list} initial="hidden" animate="visible">
                    <motion.div className="card" variants={variants.card}>
                        <h3>Your Agreements</h3>
                        <div className="agreements-list">
                            {loadingState.agreements ? (
                                Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton-card" />)
                            ) : agreements.length === 0 ? (
                                <p className="no-agreements">No agreements found. Create one to get started!</p>
                            ) : (
                                <AnimatePresence>
                                    {agreements.map(agg => (
                                        <motion.div
                                            key={agg.contractAddress}
                                            className="agreement-item"
                                            variants={variants.item}
                                            layout
                                        >
                                            <div className="item-header">
                                                <span className={`status status-${(agg.status || '').toLowerCase()}`}>{agg.status}</span>
                                                <span className="item-amount">{agg.amount} <strong>{agg.token}</strong></span>
                                            </div>
                                            <div className="item-details">
                                                <p><strong>Depositor:</strong> <span className="address-mono">{shortAddress(agg.depositor)}</span></p>
                                                <p><strong>Beneficiary:</strong> <span className="address-mono">{shortAddress(agg.beneficiary)}</span></p>
                                                <p><strong>Arbiter:</strong> <span className="address-mono">{shortAddress(agg.arbiter)}</span></p>
                                            </div>
                                            <AgreementTimer deadline={agg.deadline} status={agg.status} />
                                            <div className="item-actions">
                                                {agg.status === 'Created' && agg.depositor?.toLowerCase() === account?.toLowerCase() && (
                                                    <motion.button onClick={() => handleAction(agg, 'Fund')} disabled={!!loadingState.action} whileTap={{ scale: 0.98 }}>
                                                        {loadingState.action === `Fund-${agg.contractAddress}` ? <InlineSpinner text="Funding..." /> : 'Fund Escrow'}
                                                    </motion.button>
                                                )}
                                                {agg.status === 'Funded' && agg.arbiter?.toLowerCase() === account?.toLowerCase() && (
                                                    <motion.button onClick={() => handleAction(agg, 'Release')} disabled={!!loadingState.action} whileTap={{ scale: 0.98 }}>
                                                        {loadingState.action === `Release-${agg.contractAddress}` ? <InlineSpinner text="Releasing..." /> : 'Release Funds'}
                                                    </motion.button>
                                                )}
                                                {agg.status === 'Expired' && <p className="expired-message">This agreement has expired.</p>}
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            </div>
            
            <PageOverlayLoader show={loadingState.global} text="Processing transaction..." />
            <Toast message={uiState.message} type={uiState.type} onClose={clearMessage} />
        </div>
    );
}

export default Appln;