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
    const [myRole, setMyRole] = useState('depositor');
    const [authState, setAuthState] = useState('LOGGED_OUT');
    const [authForm, setAuthForm] = useState({ identifier: '', password: '', username: '' });
    const [registrationAddress, setRegistrationAddress] = useState(null);

    // --- Logout Function ---
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

    // --- Data Fetching Functions ---
    const fetchAgreements = useCallback(async () => {
        if (!localStorage.getItem('authToken')) return;
        try {
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
        }
    }, [logout]);
    
    const updateBalances = useCallback(async (currentAccount, currentProvider) => {
        if (!currentAccount || !currentProvider) return;
        try {
            const bnbBalance = await currentProvider.getBalance(currentAccount);
            setBnb(ethers.formatEther(bnbBalance));
            const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            setUsdt(ethers.formatUnits(await usdtContract.balanceOf(currentAccount), 18));
            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            setUsdc(ethers.formatUnits(await usdcContract.balanceOf(currentAccount), 18));
        } catch (error) {
            console.error("Failed to update balances:", error);
        }
    }, []);

    // --- Authentication Handlers ---
    const handleWalletConnect = async () => {
        if (typeof window.ethereum === "undefined") return setUiMessage("MetaMask not detected.");
        setIsLoading(true);
        setUiMessage("Connecting to wallet...");
        try {
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await newProvider.send("eth_requestAccounts", []);
            const currentAddress = accounts[0];
            
            const checkResponse = await fetch(`${API_BASE_URL}/auth/check-user/${currentAddress}`);
            const { isRegistered } = await checkResponse.json();

            if (isRegistered) {
                setUiMessage('Account found. Please log in with your password.');
                setAuthState('LOGGED_OUT');
                setAuthForm({ ...authForm, identifier: currentAddress, password: '' });
            } else {
                setUiMessage('New wallet detected. Please sign a message to prove ownership.');
                const newSigner = await newProvider.getSigner();
                await newSigner.signMessage(`Register for Escrow DApp: ${currentAddress}`);
                setRegistrationAddress(currentAddress);
                setAuthState('REGISTERING');
                setUiMessage('Signature verified! Please create a password to secure your account.');
            }
        } catch (error) {
            setUiMessage('Connection or signature failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!authForm.password) return setUiMessage("Password is required.");
        setIsLoading(true);
        setUiMessage("Creating your account...");
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
        setUiMessage("Logging in...");
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
        if (!signer || !account) return setUiMessage("Please connect wallet and sign in first.");
        const { depositor, arbiter, beneficiary, amount, token } = formState;
        if (!ethers.isAddress(depositor) || !ethers.isAddress(arbiter) || !ethers.isAddress(beneficiary) || !amount || parseFloat(amount) <= 0) {
            return setUiMessage("Please fill all fields with valid addresses and a positive amount.");
        }
        setIsLoading(true);
        setUiMessage("1/3: Deploying new escrow contract...");
        try {
            const tokenAddress = token === 'USDT' ? USDT_CONTRACT_ADDRESS : USDC_CONTRACT_ADDRESS;
            const value = ethers.parseUnits(amount, 18);
            
            const EscrowFactory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, signer);
            const escrowContract = await EscrowFactory.deploy(arbiter, beneficiary, depositor, tokenAddress, value);
            await escrowContract.waitForDeployment();
            
            const contractAddress = await escrowContract.getAddress();
            setUiMessage(`2/3: Contract deployed at ${shortAddress(contractAddress)}. Saving to database...`);
            
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
        if (!signer) return setUiMessage("Signer not found. Please reconnect wallet.");
        setIsLoading(true);
        setUiMessage(`Processing action: ${action}...`);
        try {
            const escrowContract = new ethers.Contract(agreement.contractAddress, ESCROW_ABI, signer);
            let tx;
            if (action === "Fund") {
                const tokenContract = new ethers.Contract(agreement.tokenAddress, TOKEN_ABI, signer);
                const value = ethers.parseUnits(agreement.amount, 18);
                setUiMessage("1/3: Checking token approval...");
                const allowance = await tokenContract.allowance(account, agreement.contractAddress);
                if (allowance < value) {
                    setUiMessage("2/3: Approving token transfer...");
                    const approveTx = await tokenContract.approve(agreement.contractAddress, value);
                    await approveTx.wait();
                    setUiMessage("Approval confirmed. Now funding escrow...");
                } else {
                    setUiMessage("2/3: Approval already granted. Funding escrow...");
                }
                tx = await escrowContract.fund();
            } else if (action === "Release") {
                setUiMessage("1/2: Releasing funds from escrow...");
                tx = await escrowContract.release();
            } else {
                throw new Error("Invalid action");
            }
            
            const nextStep = action === "Fund" ? "3/3" : "2/2";
            setUiMessage(`${nextStep}: Transaction sent (${shortAddress(tx.hash)}). Waiting for confirmation...`);
            await tx.wait();
            
            setUiMessage("Transaction confirmed! Updating status in database...");
            const newStatus = action === "Fund" ? "Funded" : "Released";
            const response = await api.put(`/agreements/${agreement.contractAddress}/status`, { status: newStatus });
            if (!response.ok) throw new Error("Failed to update agreement status.");

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
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            setProvider(newProvider);
            updateBalances(account, newProvider);
            fetchAgreements();
            newProvider.getSigner().then(setSigner).catch(console.error);
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

    // --- RENDER LOGIC ---
    if (authState !== 'LOGGED_IN') {
        return (
            <div className="auth-container">
                <div className="auth-box">
                    <h1>Escrow DApp</h1>
                    <p className="auth-subtitle">Secure, decentralized agreements on the blockchain.</p>
                    {uiMessage && <p className="ui-message">{uiMessage}</p>}
                    <div className="auth-columns">
                        <div className="auth-column">
                            <h2>Returning User?</h2>
                            <p>Log in with your credentials.</p>
                            <form onSubmit={handleLogin} className="auth-form">
                                <input placeholder="Wallet Address or Username" value={authForm.identifier} onChange={(e) => setAuthForm({...authForm, identifier: e.target.value})} />
                                <input type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} />
                                <button type="submit" className="btn-primary" disabled={isLoading}>{isLoading ? 'Logging in...' : 'Login'}</button>
                            </form>
                        </div>
                        <div className="column-separator"></div>
                        <div className="auth-column">
                            <h2>First Time Here?</h2>
                            <p>Connect your wallet to start.</p>
                            {authState === 'LOGGED_OUT' && (
                                <button onClick={handleWalletConnect} className="btn-connect" disabled={isLoading}>{isLoading ? "Connecting..." : "Connect & Register Wallet"}</button>
                            )}
                            {authState === 'REGISTERING' && (
                                <form onSubmit={handleRegister} className="auth-form">
                                    <p>Registering for: <strong>{shortAddress(registrationAddress)}</strong></p>
                                    <input type="password" placeholder="Create Password" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required/>
                                    <input placeholder="Username (Optional)" value={authForm.username} onChange={(e) => setAuthForm({...authForm, username: e.target.value})} />
                                    <button type="submit" className="btn-primary" disabled={isLoading}>{isLoading ? 'Creating Account...' : 'Create Account'}</button>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    
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
                        <div className="role-selector">
                            <p>I am the:</p>
                            <button className={myRole === 'depositor' ? 'active' : ''} onClick={() => setMyRole('depositor')}>Depositor</button>
                            <button className={myRole === 'arbiter' ? 'active' : ''} onClick={() => setMyRole('arbiter')}>Arbiter</button>
                            <button className={myRole === 'beneficiary' ? 'active' : ''} onClick={() => setMyRole('beneficiary')}>Beneficiary</button>
                        </div>
                        <div className="form-group">
                            {myRole !== 'depositor' ? (
                                <input placeholder="Depositor Address" value={formState.depositor} onChange={(e) => setFormState({...formState, depositor: e.target.value})} />
                            ) : <input value={shortAddress(account)} readOnly disabled />}
                            {myRole !== 'arbiter' ? (
                                <input placeholder="Arbiter Address" value={formState.arbiter} onChange={(e) => setFormState({...formState, arbiter: e.target.value})} />
                            ) : <input value={shortAddress(account)} readOnly disabled />}
                            {myRole !== 'beneficiary' ? (
                                <input placeholder="Beneficiary Address" value={formState.beneficiary} onChange={(e) => setFormState({...formState, beneficiary: e.target.value})} />
                            ) : <input value={shortAddress(account)} readOnly disabled />}
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
                            {agreements.length === 0 ? <p>No agreements found for your address.</p> :
                                agreements.map(agg => (
                                    <div key={agg.contractAddress} className="agreement-item">
                                        <div className="item-header">
                                            <span className={`status status-${agg.status.toLowerCase()}`}>{agg.status}</span>
                                            <span>{agg.amount} <strong>{agg.token}</strong></span>
                                        </div>
                                        <div className="item-details">
                                            <p><strong>Depositor:</strong> <span className="address-mono">{shortAddress(agg.depositor)}</span></p>
                                            <p><strong>Beneficiary:</strong> <span className="address-mono">{shortAddress(agg.beneficiary)}</span></p>
                                            <p><strong>Arbiter:</strong> <span className="address-mono">{shortAddress(agg.arbiter)}</span></p>
                                        </div>
                                        <div className="item-actions">
                                            {agg.status === 'Created' && agg.depositor.toLowerCase() === account?.toLowerCase() && (
                                                <button onClick={() => handleAction(agg, 'Fund')} disabled={isLoading}>Fund Escrow</button>
                                            )}
                                            {agg.status === 'Funded' && agg.arbiter.toLowerCase() === account?.toLowerCase() && (
                                                <button onClick={() => handleAction(agg, 'Release')} disabled={isLoading}>Release Funds</button>
                                            )}
                                        </div>
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