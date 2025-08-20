import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import './appln.css';

// --- Constants ---
const USDT_CONTRACT_ADDRESS = '0x787A697324dbA4AB965C58CD33c13ff5eeA6295F';
const USDC_CONTRACT_ADDRESS = '0x342e3aA1248AB77E319e3331C6fD3f1F2d4B36B1';
const TOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint amount) returns (bool)"
];

// --- Helper Functions ---
const shortAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

// --- NEW: Session Management Helpers ---
const sessionKey = "escrow_dapp_session";
const saveSession = (data) => localStorage.setItem(sessionKey, JSON.stringify(data));
const getSession = () => JSON.parse(localStorage.getItem(sessionKey));
const clearSession = () => localStorage.removeItem(sessionKey);


function Appln() {
    // --- State Management (largely the same) ---
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [account, setAccount] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [bnb, setBnb] = useState('0');
    const [usdt, setUsdt] = useState('0');
    const [usdc, setUsdc] = useState('0');
    const [agreements, setAgreements] = useState([]);
    const [formState, setFormState] = useState({ arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
    const [uiMessage, setUiMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // --- Balance Update Function (unchanged) ---
    const updateBalances = useCallback(async (currentAccount, currentProvider) => {
        if (!currentAccount || !currentProvider) return;
        try {
            const bnbBalance = await currentProvider.getBalance(currentAccount);
            setBnb(ethers.formatEther(bnbBalance));

            const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            const usdtBalance = await usdtContract.balanceOf(currentAccount);
            setUsdt(ethers.formatUnits(usdtBalance, 18));

            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            const usdcBalance = await usdcContract.balanceOf(currentAccount);
            setUsdc(ethers.formatUnits(usdcBalance, 18));
        } catch (error) {
            console.error("Failed to update balances:", error);
        }
    }, []);
    
    // --- **UPDATED: Logout Function** ---
    const logout = useCallback(() => {
        clearSession(); // Clear session from localStorage
        setProvider(null);
        setSigner(null);
        setAccount(null);
        setIsConnected(false);
        setAgreements([]);
        setUiMessage("You have been successfully logged out.");
        // We can even force a reload to ensure a clean state
        // window.location.reload(); 
    }, []);

    // --- **NEW: connectWallet with Signature** ---
    const connectWallet = async () => {
        if (typeof window.ethereum === "undefined") {
            return setUiMessage("MetaMask not detected. Please install it.");
        }
        
        setIsLoading(true);
        setUiMessage("Connecting to MetaMask...");

        try {
            // 1. Request wallet connection
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await newProvider.send("eth_requestAccounts", []);
            
            if (!accounts || accounts.length === 0) {
                setIsLoading(false);
                return setUiMessage("No accounts found in MetaMask.");
            }
            const newSigner = await newProvider.getSigner();
            const currentAddress = accounts[0];

            // 2. Create a challenge message for the user to sign
            setUiMessage("Please sign the message to authenticate...");
            const challenge = `Sign this message to log into the Escrow DApp.\nTime: ${Date.now()}`;

            // 3. Request signature from user
            const signature = await newSigner.signMessage(challenge);

            // 4. Save authentication proof in localStorage
            saveSession({ address: currentAddress, signature, challenge });
            
            // 5. Update UI state to log the user in
            setProvider(newProvider);
            setSigner(newSigner);
            setAccount(currentAddress);
            setIsConnected(true);
            setUiMessage(""); // Clear message on success

        } catch (error) {
            console.error("Connection/signature failed:", error);
            if (error.code === 4001) { // EIP-1193 user rejected request
                setUiMessage("You must approve the request to continue.");
            } else {
                setUiMessage("Connection failed. Please try again.");
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- **UPDATED: Effect to handle account changes** ---
    useEffect(() => {
        const handleAccountsChanged = (accounts) => {
            if (accounts.length === 0 || getSession()?.address.toLowerCase() !== accounts[0].toLowerCase()) {
                // If accounts array is empty OR the current session address doesn't match the new active account, log out.
                logout();
            }
        };

        if (window.ethereum) {
            window.ethereum.on('accountsChanged', handleAccountsChanged);
        }

        return () => {
            if (window.ethereum) {
                window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
            }
        };
    }, [logout]);


    // --- **NEW: Effect to check for existing session on page load** ---
    useEffect(() => {
        const checkExistingSession = async () => {
            const session = getSession();
            // A more robust check would verify the signature, but for this app, checking presence is enough.
            if (session?.address && typeof window.ethereum !== "undefined") {
                setIsLoading(true);
                const newProvider = new ethers.BrowserProvider(window.ethereum);
                // Check if the saved account is still available
                const availableAccounts = await newProvider.listAccounts();
                if (availableAccounts.some(acc => acc.address.toLowerCase() === session.address.toLowerCase())) {
                    const newSigner = await newProvider.getSigner();
                    setProvider(newProvider);
                    setSigner(newSigner);
                    setAccount(session.address);
                    setIsConnected(true);
                } else {
                    // The previously logged-in account is no longer connected in MetaMask
                    clearSession();
                }
                setIsLoading(false);
            }
        };

        checkExistingSession();
    }, []);

    // --- Effect to fetch balances when account changes (unchanged) ---
    useEffect(() => {
        if (account && provider) {
            updateBalances(account, provider);
        }
    }, [account, provider, updateBalances]);

    // --- Escrow Core Functions (unchanged, but provided for completeness) ---
    const createAgreement = () => {
        const { arbiter, beneficiary, amount, token } = formState;
        if (!ethers.isAddress(arbiter) || !ethers.isAddress(beneficiary) || !amount) {
            setUiMessage("Please fill all fields with valid addresses and an amount.");
            return;
        }

        const newAgreement = {
            id: Date.now(),
            depositor: account,
            arbiter,
            beneficiary,
            amount,
            token,
            status: 'Created',
        };

        setAgreements(prev => [...prev, newAgreement]);
        setFormState({ arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
        setUiMessage("Agreement created successfully. Ready to be funded.");
    };
    
    const handleAction = async (agreementId, action) => {
        const agreement = agreements.find(a => a.id === agreementId);
        if (!agreement) return;

        setIsLoading(true);
        setUiMessage(`Processing action: ${action}...`);

        try {
            if (action === "Fund") {
                const tokenAddress = agreement.token === 'USDT' ? USDT_CONTRACT_ADDRESS : USDC_CONTRACT_ADDRESS;
                const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
                const value = ethers.parseUnits(agreement.amount, 18);
                const toAddress = agreement.beneficiary;

                const tx = await tokenContract.transfer(toAddress, value);
                setUiMessage(`Transaction sent (${tx.hash}). Waiting for confirmation...`);
                await tx.wait();
                
                setUiMessage(`Transaction confirmed! Agreement is now Funded.`);
                setAgreements(agreements.map(a => a.id === agreementId ? { ...a, status: 'Funded' } : a));
            
            } else if (action === "Release") {
                setUiMessage(`Arbiter has approved the release.`);
                setAgreements(agreements.map(a => a.id === agreementId ? { ...a, status: 'Released' } : a));
            }
        } catch (error) {
            const userFriendlyError = error.reason || error.message;
            setUiMessage(`Error during ${action}: ${userFriendlyError}`);
        } finally {
            setIsLoading(false);
        }
    };


    // --- RENDER LOGIC (updated with loading states) ---
    if (!isConnected) {
        return (
            <div className="auth-container">
                <div className="auth-box">
                    <h1>Escrow DApp</h1>
                    <p>Connect and sign with your MetaMask wallet to begin.</p>
                    <button onClick={connectWallet} className="btn-connect" disabled={isLoading}>
                        {isLoading ? "Connecting..." : "Connect Wallet"}
                    </button>
                    {uiMessage && <p className="ui-message">{uiMessage}</p>}
                </div>
            </div>
        );
    }

    // Main Application Page (unchanged JSX)
    return (
        <div className="main-container">
            <header className="main-header">
                <h2>Escrow Agreement Dashboard</h2>
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
                            {agreements.length === 0 ? <p>No agreements created yet.</p> :
                                agreements.map(agg => (
                                    <div key={agg.id} className="agreement-item">
                                        <div className="item-header">
                                            <span className={`status status-${agg.status.toLowerCase()}`}>{agg.status}</span>
                                            <span>{agg.amount} <strong>{agg.token}</strong></span>
                                        </div>
                                        <div className="item-details">
                                            <p><strong>Depositor:</strong> {shortAddress(agg.depositor)}</p>
                                            <p><strong>Beneficiary:</strong> {shortAddress(agg.beneficiary)}</p>
                                            <p><strong>Arbiter:</strong> {shortAddress(agg.arbiter)}</p>
                                        </div>
                                        <div className="item-actions">
                                            {agg.status === 'Created' && agg.depositor === account && (
                                                <button onClick={() => handleAction(agg.id, 'Fund')} disabled={isLoading}>Fund</button>
                                            )}
                                            {agg.status === 'Funded' && agg.arbiter === account && (
                                                <button onClick={() => handleAction(agg.id, 'Release')} disabled={isLoading}>Release Funds</button>
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