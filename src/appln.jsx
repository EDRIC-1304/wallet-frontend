import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { motion, AnimatePresence } from 'framer-motion';
import './appln.css'; // The new CSS file
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

// --- API Utility with JWT ---
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

// --- Live Background Component ---
const CanvasBackground = () => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let animationFrameId;

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resizeCanvas();

        let particles = [];
        const particleCount = 70;
        const connectDistance = canvas.width / 6;

        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 1.5 + 0.5
            });
        }

        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;

                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
                ctx.fill();
            });

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
                    if (dist < connectDistance) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0, 255, 255, ${1 - dist / connectDistance})`;
                        ctx.lineWidth = 0.3;
                        ctx.stroke();
                    }
                }
            }

            animationFrameId = requestAnimationFrame(draw);
        };

        draw();

        window.addEventListener('resize', resizeCanvas);
        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', resizeCanvas);
        };
    }, []);

    return <canvas ref={canvasRef} id="matrix-background" />;
};


// --- Reusable Timer Component ---
const AgreementTimer = ({ deadline, status }) => {
    const calculateTimeLeft = useCallback(() => {
        const difference = new Date(deadline) - new Date();
        if (difference > 0) {
            return {
                minutes: Math.floor((difference / 1000 / 60) % 60),
                seconds: Math.floor((difference / 1000) % 60),
            };
        }
        return {};
    }, [deadline]);

    const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

    useEffect(() => {
        if (status !== 'Created') return;
        const timer = setInterval(() => setTimeLeft(calculateTimeLeft()), 1000);
        return () => clearInterval(timer);
    }, [status, calculateTimeLeft]);

    if (status !== 'Created' && status !== 'Expired') return null;

    const timerText = Object.keys(timeLeft).length
        ? `${String(timeLeft.minutes).padStart(2, '0')}:${String(timeLeft.seconds).padStart(2, '0')}`
        : "TIME EXPIRED";

    return (
        <div className="timer data-field">
            <span className="timer-text">FUNDING DEADLINE: {timerText}</span>
        </div>
    );
};

// --- Loader Components (pure UI) ---
const InlineSpinner = () => (
    <div className="spinner-container">
        <div className="spinner-blade"></div>
        <div className="spinner-blade"></div>
        <div className="spinner-blade"></div>
    </div>
);

const PageOverlayLoader = ({ show, text = "Processing..." }) => (
    <AnimatePresence>
        {show && (
            <motion.div
                className="overlay-loader"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <motion.div
                    className="overlay-card terminal-card"
                    initial={{ y: -30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 30, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                >
                     <div className="spinner-container">
                        <div className="spinner-blade"></div>
                        <div className="spinner-blade"></div>
                        <div className="spinner-blade"></div>
                    </div>
                    <p className="glitch" data-text={text}>{text}</p>
                </motion.div>
            </motion.div>
        )}
    </AnimatePresence>
);

// --- Toast (auto-dismiss) ---
const Toast = ({ message, onClose }) => {
    useEffect(() => {
        if (!message) return;
        const t = setTimeout(() => onClose?.(), 4000);
        return () => clearTimeout(t);
    }, [message, onClose]);

    return (
        <AnimatePresence>
            {message && (
                <motion.div
                    className="toast"
                    initial={{ y: 50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 50, opacity: 0 }}
                >
                    <div className="toast-content" data-text={message}>{message}</div>
                </motion.div>
            )}
        </AnimatePresence>
    );
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
    const [formState, setFormState] = useState({
        depositor: '',
        arbiter: '',
        beneficiary: '',
        amount: '',
        token: 'USDT'
    });
    const [uiMessage, setUiMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [balancesLoading, setBalancesLoading] = useState(false);
    const [agreementsLoading, setAgreementsLoading] = useState(false);
    const [myRole, setMyRole] = useState('depositor');
    const [authState, setAuthState] = useState('LOGGED_OUT');
    const [authForm, setAuthForm] = useState({ identifier: '', password: '', username: '', email: '' }); // ADDED 'email'
    const [registrationAddress, setRegistrationAddress] = useState(null);
    const [copiedHash, setCopiedHash] = useState(null);

    // --- Logout Function ---
    const logout = useCallback(() => {
        localStorage.removeItem('authToken');
        setAccount(null);
        setProvider(null);
        setSigner(null);
        setAuthState('LOGGED_OUT');
        setAgreements([]);
        setAuthForm({ identifier: '', password: '', username: '' });
        setUiMessage("User session terminated.");
    }, []);

    // --- Disconnect Wallet Function ---
    // This function will handle clearing the app's internal state and attempting MetaMask permission revocation
    const disconnectWallet = useCallback(async () => {
        setUiMessage("Disconnecting MetaMask...");
        try {
            // Attempt to revoke permissions for eth_accounts in MetaMask
            // This might open a MetaMask popup for user confirmation
            if (window.ethereum && window.ethereum.request) {
                await window.ethereum.request({
                    method: 'wallet_revokePermissions',
                    params: [{ eth_accounts: {} }],
                });
            }
            
            // Clear all local storage relevant to this app's session
            // Using clear() is fine for development, but for production, you might want specific removeItem() calls
            localStorage.clear(); 
            
            // Reset all relevant state in your React app
            setAccount(null);
            setProvider(null);
            setSigner(null);
            setAuthState('LOGGED_OUT');
            setAgreements([]);
            setAuthForm({ identifier: '', password: '', username: '', email: '' });
            setRegistrationAddress(null); // Clear any pending registration address
            setUiMessage("MetaMask disconnected. You can now connect as a new user.");
        } catch (error) {
            console.error("Error disconnecting MetaMask:", error);
            // Inform user if there was an issue, but still clear local state
            setUiMessage("Failed to fully disconnect MetaMask. Please try manually in MetaMask if issues persist. Local session cleared.");
        } finally {
            // Ensure UI state is reset even if MetaMask interaction failed
            setAccount(null);
            setProvider(null);
            setSigner(null);
            setAuthState('LOGGED_OUT');
            setAgreements([]);
            setAuthForm({ identifier: '', password: '', username: '', email: '' });
            setRegistrationAddress(null);
        }
    }, []);


    // --- Data Fetching Functions ---
    const fetchAgreements = useCallback(async () => {
        if (!localStorage.getItem('authToken')) return;
        try {
            setAgreementsLoading(true);
            const response = await api.get('/agreements');
            if (!response.ok) {
                if (response.status === 401) logout();
                throw new Error("Session expired or invalid.");
            }
            const data = await response.json();
            setAgreements(data);
            setUiMessage("");
        } catch (error) {
            console.error(error);
            setUiMessage(`Error: Could not fetch agreements.`);
        } finally {
            setAgreementsLoading(false);
        }
    }, [logout]);

    const updateBalances = useCallback(async (currentAccount, currentProvider) => {
        if (!currentAccount || !currentProvider) return;
        try {
            setBalancesLoading(true);
            const bnbBalance = await currentProvider.getBalance(currentAccount);
            setBnb(ethers.formatEther(bnbBalance));
            const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            setUsdt(ethers.formatUnits(await usdtContract.balanceOf(currentAccount), 18));
            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            setUsdc(ethers.formatUnits(await usdcContract.balanceOf(currentAccount), 18));
        } catch (error) {
            console.error("Failed to update balances:", error);
        } finally {
            setBalancesLoading(false);
        }
    }, []);

    // --- Authentication Handlers ---
    const handleWalletConnect = async () => {
        if (typeof window.ethereum === "undefined") return setUiMessage("MetaMask connection failed.");
        setIsLoading(true);
        setUiMessage("Initializing wallet handshake...");
        try {
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await newProvider.send("eth_requestAccounts", []);
            const currentAddress = accounts[0];

            const checkResponse = await fetch(`${API_BASE_URL}/auth/check-user/${currentAddress}`);
            const { isRegistered } = await checkResponse.json();

            if (isRegistered) {
                setUiMessage('Identity confirmed. Awaiting password.');
                setAuthState('LOGGED_OUT');
                setAuthForm({ ...authForm, identifier: currentAddress, password: '' });
            } else {
                setUiMessage('New identity detected. Awaiting signature verification.');
                const newSigner = await newProvider.getSigner();
                await newSigner.signMessage(`Register for Escrow DApp: ${currentAddress}`);
                setRegistrationAddress(currentAddress);
                setAuthState('REGISTERING');
                setUiMessage('Signature verified. Secure your account with a password.');
            }
        } catch (error) {
            setUiMessage('Handshake or signature failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!authForm.password) return setUiMessage("Password is required.");
        setIsLoading(true);
        setUiMessage("Encrypting and storing credentials...");
        try {
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: registrationAddress,
                    password: authForm.password,
                    username: authForm.username || undefined,
                    email: authForm.email || undefined,
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            localStorage.setItem('authToken', data.token);
            setAccount(registrationAddress);
            setAuthState('LOGGED_IN');
            setUiMessage('');
        } catch (error) {
            setUiMessage(`Registration failed: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setUiMessage("Authenticating...");
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

            const decodedToken = JSON.parse(atob(data.token.split('.')[1]));
            setAccount(decodedToken.address);
            localStorage.setItem('authToken', data.token);
            setAuthState('LOGGED_IN');
            setUiMessage('');
        } catch (error) {
            setUiMessage(`Login failed: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    // --- Escrow Core Functions ---
    const createAgreement = async () => {
        if (!signer || !account) return setUiMessage("Connect wallet and sign in first.");
        const { depositor, arbiter, beneficiary, amount, token } = formState;
        if (!ethers.isAddress(depositor) || !ethers.isAddress(arbiter) || !ethers.isAddress(beneficiary) || !amount || parseFloat(amount) <= 0) {
            return setUiMessage("Invalid addresses or amount provided.");
        }
        setIsLoading(true);
        setUiMessage("1/3: Deploying escrow contract...");
        try {
            const tokenAddress = token === 'USDT' ? USDT_CONTRACT_ADDRESS : USDC_CONTRACT_ADDRESS;
            const value = ethers.parseUnits(amount, 18);

            const EscrowFactory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, signer);
            const escrowContract = await EscrowFactory.deploy(arbiter, beneficiary, depositor, tokenAddress, value);
            await escrowContract.waitForDeployment();

            const contractAddress = await escrowContract.getAddress();
            setUiMessage(`2/3: Contract deployed at ${shortAddress(contractAddress)}. Saving...`);

            const response = await api.post('/agreements', { contractAddress, depositor, arbiter, beneficiary, amount, token, tokenAddress });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to save agreement.");
            }

            setUiMessage("3/3: Agreement created and saved successfully!");
            setFormState({ depositor: '', arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
            setMyRole('depositor');
            fetchAgreements();
        } catch (error) {
            const userFriendlyError = error.reason || error.message;
            setUiMessage(`Error creating agreement: ${userFriendlyError}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAction = async (agreement, action) => {
    if (!signer) return setUiMessage("Signer not found. Reconnect wallet.");
    setIsLoading(true);
    setUiMessage(`Processing: ${action}...`);
    try {
        const escrowContract = new ethers.Contract(agreement.contractAddress, ESCROW_ABI, signer);
        let tx;
        // ... (if/else for Fund/Release actions remains the same)
        if (action === "Fund") {
            // ... token approval logic
            tx = await escrowContract.fund();
        } else if (action === "Release") {
            setUiMessage("1/2: Releasing funds...");
            tx = await escrowContract.release();
        } else {
            throw new Error("Invalid action");
        }

        const nextStep = action === "Fund" ? "3/3" : "2/2";
        setUiMessage(`${nextStep}: Tx sent (${shortAddress(tx.hash)}). Awaiting confirmation...`);
        await tx.wait();

        setUiMessage("Tx confirmed! Updating database...");
        const newStatus = action === "Fund" ? "Funded" : "Released";

        // --- MODIFIED: Send the transaction hash along with the new status ---
        const response = await api.put(`/agreements/${agreement.contractAddress}/status`, {
            status: newStatus,
            transactionHash: tx.hash // Send the hash to the backend
        });
        if (!response.ok) throw new Error("Failed to update status.");

        setUiMessage(`Agreement successfully ${newStatus}!`);
        fetchAgreements();
    } catch (error) {
        const userFriendlyError = error.reason || error.message;
        setUiMessage(`Error during ${action}: ${userFriendlyError}`);
    } finally {
        setIsLoading(false);
    }
};

    // --- Use Effects ---
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
            if (window.ethereum) {
                const newProvider = new ethers.BrowserProvider(window.ethereum);
                setProvider(newProvider);
                updateBalances(account, newProvider);
                newProvider.getSigner().then(setSigner).catch(console.error);
            }
            fetchAgreements();
        }
    }, [authState, account, updateBalances, fetchAgreements]);

    useEffect(() => {
        if (account) {
            setFormState(prevState => ({
                ...prevState,
                depositor: myRole === 'depositor' ? account : '',
                arbiter: myRole === 'arbiter' ? account : '',
                beneficiary: myRole === 'beneficiary' ? account : '',
            }));
        }
    }, [myRole, account]);

    const uiToastClose = useCallback(() => {
        if (!isLoading) setUiMessage('');
    }, [isLoading]);

    // --- Motion Variants ---
    const terminalCardVariant = {
        hidden: { opacity: 0, pathLength: 0 },
        visible: { opacity: 1, pathLength: 1, transition: { duration: 0.7, ease: "easeInOut" } }
    };

    const contentVariant = {
        hidden: { opacity: 0, y: 15 },
        visible: (i = 1) => ({
            opacity: 1,
            y: 0,
            transition: { staggerChildren: 0.1, delayChildren: 0.2 * i },
        }),
    };

    const itemVariant = {
        hidden: { opacity: 0, y: 10, filter: 'blur(5px)' },
        visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.3 } }
    };


    if (authState !== 'LOGGED_IN') {
        return (
            <>
                <CanvasBackground />
                <div className="auth-container">
                    <motion.div
                        className="auth-box terminal-card"
                        variants={contentVariant}
                        initial="hidden"
                        animate="visible"
                    >
                         <svg className="card-border" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                            <rect width="100%" height="100%" fill="none" rx="8" ry="8" vectorEffect="non-scaling-stroke" stroke="rgba(0, 255, 255, 0.5)" strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset="0" />
                        </svg>
                        <motion.h1 className="glitch" data-text="ESCROW_DAPP" variants={itemVariant}>ESCROW_DAPP</motion.h1>
                        <motion.p className="auth-subtitle" variants={itemVariant}>Secure P2P agreements on the blockchain.</motion.p>
                        {uiMessage && <p className="ui-message glitch" data-text={uiMessage}>{uiMessage}</p>}

                        <div className="auth-columns">
                            <motion.div className="auth-column" variants={contentVariant}>
                                <motion.h2 variants={itemVariant}>// Returning User</motion.h2>
                                <motion.p variants={itemVariant}>Authenticate with existing credentials.</motion.p>
                                <form onSubmit={handleLogin} className="auth-form">
                                    <motion.input variants={itemVariant} placeholder="Wallet Address / Username / Email" value={authForm.identifier} onChange={(e) => setAuthForm({ ...authForm, identifier: e.target.value })} />
                                    <motion.input variants={itemVariant} type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
                                    <motion.button type="submit" className="btn btn-primary" disabled={isLoading} variants={itemVariant}>
                                        {isLoading ? 'Authenticating...' : 'Login'}
                                    </motion.button>
                                </form>
                                {/* NEW DISCONNECT BUTTON HERE */}
                                <motion.button 
                                    onClick={disconnectWallet} 
                                    className="btn btn-tertiary" 
                                    disabled={isLoading} 
                                    variants={itemVariant}
                                >
                                    Disconnect MetaMask
                                </motion.button>
                            </motion.div>
                            <motion.div className="auth-column" variants={contentVariant}>
                                <motion.h2 variants={itemVariant}>// New User</motion.h2>
                                <motion.p variants={itemVariant}>Connect wallet to register.</motion.p>
                                {authState === 'LOGGED_OUT' && (
                                    <motion.button onClick={handleWalletConnect} className="btn btn-secondary" disabled={isLoading} variants={itemVariant}>
                                        {isLoading ? 'Connecting...' : 'Connect & Register Wallet'}
                                    </motion.button>
                                )}
                                {authState === 'REGISTERING' && (
                                    <form onSubmit={handleRegister} className="auth-form">
                                        <p className="register-address">Registering: <strong>{shortAddress(registrationAddress)}</strong></p>
                                        <motion.input variants={itemVariant} type="password" placeholder="Create Password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
                                        <motion.input variants={itemVariant} placeholder="Username (Optional)" value={authForm.username} onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} />
                                                                                <motion.input variants={itemVariant} placeholder="Username (Optional)" value={authForm.username} onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} />
                                        <motion.input variants={itemVariant} type="email" placeholder="Email (Optional)" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} /> {/* ADD THIS EMAIL INPUT */}
                                        <motion.button type="submit" className="btn btn-primary" disabled={isLoading} variants={itemVariant}>
                                            {isLoading ? 'Creating Account...' : 'Create Account'}
                                        </motion.button>
                                    </form>
                                )}
                            </motion.div>
                        </div>
                    </motion.div>
                    <Toast message={uiMessage} onClose={uiToastClose} />
                    <PageOverlayLoader show={isLoading} text="Awaiting Blockchain Confirmation..." />
                </div>
            </>
        );
    }

    return (
        <>
            <CanvasBackground />
            <div className="main-container">
                <header className="main-header">
                    <h2 className="glitch" data-text="Escrow Dashboard">Escrow Dashboard</h2>
                    <div className="header-right">
                        <p className="data-field"><span>USER:</span> {shortAddress(account)}</p>
                        <button onClick={logout} className="btn btn-logout">
                            [Logout]
                        </button>
                    </div>
                </header>

                <div className="content-grid">
                    <motion.div className="column-left" variants={contentVariant} initial="hidden" animate="visible">
                        <motion.div className="terminal-card" variants={itemVariant}>
                            <h3>// Balances</h3>
                            <div className="balance-list">
                                {balancesLoading ? (
                                    <>
                                        <div className="skeleton-line" />
                                        <div className="skeleton-line" />
                                        <div className="skeleton-line" />
                                    </>
                                ) : (
                                    <>
                                        <p className="data-field"><span>BNB:</span> {parseFloat(bnb).toFixed(4)}</p>
                                        <p className="data-field"><span>USDT:</span> {parseFloat(usdt).toFixed(2)}</p>
                                        <p className="data-field"><span>USDC:</span> {parseFloat(usdc).toFixed(2)}</p>
                                    </>
                                )}
                            </div>
                            <button className="btn btn-secondary" onClick={() => updateBalances(account, provider)} disabled={balancesLoading}>
                                {balancesLoading ? 'Refreshing...' : 'Refresh'}
                            </button>
                        </motion.div>

                        <motion.div className="terminal-card" variants={itemVariant}>
                            <h3>// Create New Escrow</h3>
                            <div className="role-selector">
                                <p>My Role:</p>
                                <button className={`btn-toggle ${myRole === 'depositor' ? 'active' : ''}`} onClick={() => setMyRole('depositor')}>Depositor</button>
                                <button className={`btn-toggle ${myRole === 'arbiter' ? 'active' : ''}`} onClick={() => setMyRole('arbiter')}>Arbiter</button>
                                <button className={`btn-toggle ${myRole === 'beneficiary' ? 'active' : ''}`} onClick={() => setMyRole('beneficiary')}>Beneficiary</button>
                            </div>
                            <div className="form-group">
                                {myRole !== 'depositor' ? ( <input placeholder="Depositor Address" value={formState.depositor} onChange={(e) => setFormState({ ...formState, depositor: e.target.value })} /> ) : ( <input value={shortAddress(account)} readOnly disabled /> )}
                                {myRole !== 'arbiter' ? ( <input placeholder="Arbiter Address" value={formState.arbiter} onChange={(e) => setFormState({ ...formState, arbiter: e.target.value })} /> ) : ( <input value={shortAddress(account)} readOnly disabled /> )}
                                {myRole !== 'beneficiary' ? ( <input placeholder="Beneficiary Address" value={formState.beneficiary} onChange={(e) => setFormState({ ...formState, beneficiary: e.target.value })} /> ) : ( <input value={shortAddress(account)} readOnly disabled /> )}
                                <div className="amount-input-group">
                                    <input type="number" placeholder="Amount" value={formState.amount} onChange={(e) => setFormState({ ...formState, amount: e.target.value })} />
                                    <select value={formState.token} onChange={(e) => setFormState({ ...formState, token: e.target.value })}>
                                        <option value="USDT">USDT</option>
                                        <option value="USDC">USDC</option>
                                    </select>
                                </div>
                                <button onClick={createAgreement} disabled={isLoading} className="btn btn-primary">
                                    {isLoading ? 'Creating...' : 'Create Agreement'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>

                    <motion.div className="column-right" variants={contentVariant} initial="hidden" animate="visible">
                        <motion.div className="terminal-card" variants={itemVariant}>
                            <h3>// Your Agreements</h3>
                            {uiMessage && <p className="ui-message-inline glitch" data-text={uiMessage}>{uiMessage}</p>}
                            <div className="agreements-list">
                                {agreementsLoading ? (
                                    <>
                                        <div className="skeleton-card" />
                                        <div className="skeleton-card" />
                                        <div className="skeleton-card" />
                                    </>
                                ) : agreements.length === 0 ? (
                                    <p>No agreements found for your address.</p>
                                ) : (
                                    // ... inside the return() of the Appln component, in the agreements-list section

<AnimatePresence>
    {agreements.map(agg => (
        <motion.div
            key={agg.contractAddress}
            className="agreement-item"
            variants={itemVariant}
            exit={{ opacity: 0, x: -50 }}
            layout
        >
            <div className="item-header">
                <span className={`status status-${(agg.status || '').toLowerCase()}`}>{agg.status}</span>
                <span className='item-amount'>{agg.amount} <strong>{agg.token}</strong></span>
            </div>
            <div className="item-details">
                <p className="data-field"><span>Depositor:</span> {shortAddress(agg.depositor)}</p>
                <p className="data-field"><span>Beneficiary:</span> {shortAddress(agg.beneficiary)}</p>
                <p className="data-field"><span>Arbiter:</span> {shortAddress(agg.arbiter)}</p>
            </div>

            {/* --- ADD THIS ENTIRE BLOCK --- */}
            {/* It conditionally renders if a transaction hash exists for the agreement */}
            {agg.transactionHash && (
                <div className="tx-hash-container data-field">
                    <span>TX HASH:</span>
                    <span className="hash-text">{shortAddress(agg.transactionHash)}</span>
                    <button
                        className="btn-copy"
                        onClick={() => {
                            navigator.clipboard.writeText(agg.transactionHash);
                            setCopiedHash(agg.transactionHash);
                            setTimeout(() => setCopiedHash(null), 2500); // Reset after 2.5 seconds
                        }}
                    >
                        {copiedHash === agg.transactionHash ? 'Copied!' : '[Copy]'}
                    </button>
                </div>
            )}
            {/* --- END OF NEW BLOCK --- */}

            <AgreementTimer deadline={agg.deadline} status={agg.status} />
            <div className="item-actions">
                {/* ... (your existing Fund/Release buttons) */}
            </div>
        </motion.div>
         ))}
        </AnimatePresence>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                </div>

                <Toast message={uiMessage} onClose={uiToastClose} />
                <PageOverlayLoader show={isLoading} text="Processing Transaction..." />
            </div>
        </>
    );
}

export default Appln;