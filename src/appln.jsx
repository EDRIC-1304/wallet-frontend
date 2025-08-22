import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import './appln.css';
// Make sure you have copied Escrow.json into your src folder from the hardhat artifacts
import EscrowJson from './Escrow.json';

// --- Constants ---
const API_BASE_URL = 'https://wallet-backend-kwhe.onrender.com'; // Or your deployed backend URL
const USDT_CONTRACT_ADDRESS = '0x787A697324dbA4AB965C58CD33c13ff5eeA6295F'; // BNB Testnet USDT
const USDC_CONTRACT_ADDRESS = '0x342e3aA1248AB77E319e3331C6fD3f1F2d4B36B1'; // BNB Testnet USDC
const TOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint amount) returns (bool)",
    "function transfer(address to, uint amount) returns (bool)" // Not for escrow, but good for balances
];
const ESCROW_ABI = EscrowJson.abi;
const ESCROW_BYTECODE = EscrowJson.bytecode;


// --- Helper Functions ---
const shortAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';


// --- Session Management Helpers (Unchanged) ---
const sessionKey = "escrow_dapp_session";
const saveSession = (data) => localStorage.setItem(sessionKey, JSON.stringify(data));
const getSession = () => JSON.parse(localStorage.getItem(sessionKey));
const clearSession = () => localStorage.removeItem(sessionKey);


function Appln() {
    // --- State Management ---
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

    // --- Data Fetching & Callbacks ---
    const fetchAgreements = useCallback(async (currentAccount) => {
        if (!currentAccount) return;
        try {
            const response = await fetch(`${API_BASE_URL}/agreements/${currentAccount}`);
            if (!response.ok) throw new Error("Failed to fetch agreements from the server.");
            const data = await response.json();
            setAgreements(data);
        } catch (error) {
            console.error(error);
            setUiMessage(`Error: Could not fetch agreements.`);
        }
    }, []);
    
    const updateBalances = useCallback(async (currentAccount, currentProvider) => {
        if (!currentAccount || !currentProvider) return;
        try {
            const bnbBalance = await currentProvider.getBalance(currentAccount);
            setBnb(ethers.formatEther(bnbBalance));
            const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            const usdtBalance = await usdtContract.balanceOf(currentAccount);
            setUsdt(ethers.formatUnits(usdtBalance, 18)); // Assuming 18 decimals for USDT
            const usdcContract = new ethers.Contract(USDC_CONTRACT_ADDRESS, TOKEN_ABI, currentProvider);
            const usdcBalance = await usdcContract.balanceOf(currentAccount);
            setUsdc(ethers.formatUnits(usdcBalance, 18)); // Assuming 18 decimals for USDC
        } catch (error) {
            console.error("Failed to update balances:", error);
        }
    }, []);

    const logout = useCallback(() => {
        clearSession();
        setProvider(null);
        setSigner(null);
        setAccount(null);
        setIsConnected(false);
        setAgreements([]);
        setUiMessage("You have been successfully logged out.");
    }, []);

    // --- Wallet Connection Logic (Unchanged) ---
    const connectWallet = async () => {
        if (typeof window.ethereum === "undefined") {
            return setUiMessage("MetaMask not detected. Please install it.");
        }
        setIsLoading(true);
        setUiMessage("Connecting to MetaMask...");
        try {
            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await newProvider.send("eth_requestAccounts", []);
            const newSigner = await newProvider.getSigner();
            const currentAddress = accounts[0];
            const challenge = `Sign this message to log into the Escrow DApp.\nTime: ${Date.now()}`;
            await newSigner.signMessage(challenge);
            saveSession({ address: currentAddress });
            setProvider(newProvider);
            setSigner(newSigner);
            setAccount(currentAddress);
            setIsConnected(true);
            setUiMessage("");
        } catch (error) {
            console.error("Connection failed:", error);
            setUiMessage("Connection failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- Use Effects ---
    useEffect(() => {
        const handleAccountsChanged = (accounts) => {
            if (accounts.length === 0 || getSession()?.address.toLowerCase() !== accounts[0].toLowerCase()) {
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
    
    useEffect(() => {
        const initializeApp = async () => {
            const session = getSession();
            if (session?.address && typeof window.ethereum !== "undefined") {
                try {
                    const newProvider = new ethers.BrowserProvider(window.ethereum);
                    const newSigner = await newProvider.getSigner();
                    setProvider(newProvider);
                    setSigner(newSigner);
                    setAccount(session.address);
                    setIsConnected(true);
                } catch (error) {
                    console.error("Error reconnecting session:", error);
                    clearSession();
                }
            }
        };
        initializeApp();
    }, []);

    useEffect(() => {
        if (account && provider) {
            updateBalances(account, provider);
            fetchAgreements(account);
        }
    }, [account, provider, updateBalances, fetchAgreements]);

    // --- Escrow Core Functions (Completely Reworked) ---
    const createAgreement = async () => {
        if (!signer || !account) return setUiMessage("Please connect your wallet first.");
        const { arbiter, beneficiary, amount, token } = formState;
        if (!ethers.isAddress(arbiter) || !ethers.isAddress(beneficiary) || !amount || parseFloat(amount) <= 0) {
            return setUiMessage("Please fill all fields with valid addresses and a positive amount.");
        }
        setIsLoading(true);
        setUiMessage("1/3: Deploying new escrow contract...");
        try {
            const tokenAddress = token === 'USDT' ? USDT_CONTRACT_ADDRESS : USDC_CONTRACT_ADDRESS;
            const value = ethers.parseUnits(amount, 18);
            
            const EscrowFactory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, signer);
            const escrowContract = await EscrowFactory.deploy(arbiter, beneficiary, account, tokenAddress, value);
            await escrowContract.waitForDeployment();
            
            const contractAddress = await escrowContract.getAddress();
            setUiMessage(`2/3: Contract deployed at ${shortAddress(contractAddress)}. Saving to database...`);
            
            const response = await fetch(`${API_BASE_URL}/agreements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contractAddress, depositor: account, arbiter, beneficiary, amount, token, tokenAddress }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to save agreement to the database.");
            }
            
            setUiMessage("3/3: Agreement created and saved successfully!");
            setFormState({ arbiter: '', beneficiary: '', amount: '', token: 'USDT' });
            fetchAgreements(account); // Refresh list to show the new agreement

        } catch (error) {
            const userFriendlyError = error.reason || error.message;
            setUiMessage(`Error creating agreement: ${userFriendlyError}`);
            console.error(error);
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

            const response = await fetch(`${API_BASE_URL}/agreements/${agreement.contractAddress}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });

            if (!response.ok) throw new Error("Failed to update agreement status in the database.");

            setUiMessage(`Agreement successfully ${newStatus}!`);
            fetchAgreements(account); // Refresh the list

        } catch (error) {
            const userFriendlyError = error.reason || error.message;
            setUiMessage(`Error during ${action}: ${userFriendlyError}`);
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };


    // --- RENDER LOGIC ---
    if (!isConnected) {
        return (
            <div className="auth-container">
                <div className="auth-box">
                    <h1>Escrow DApp</h1>
                    <p>Connect your MetaMask wallet to manage secure agreements on the blockchain.</p>
                    <button onClick={connectWallet} className="btn-connect" disabled={isLoading}>
                        {isLoading ? "Connecting..." : "Connect Wallet"}
                    </button>
                    {uiMessage && <p className="ui-message">{uiMessage}</p>}
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
                                        <div className="item-header">
                                            <span className={`status status-${agg.status.toLowerCase()}`}>{agg.status}</span>
                                            <span>{agg.amount} <strong>{agg.token}</strong></span>
                                        </div>
                                        <div className="item-details">
                                            <p><strong>Contract:</strong> <span className="address-mono">{shortAddress(agg.contractAddress)}</span></p>
                                            <p><strong>Depositor:</strong> <span className="address-mono">{shortAddress(agg.depositor)}</span></p>
                                            <p><strong>Beneficiary:</strong> <span className="address-mono">{shortAddress(agg.beneficiary)}</span></p>
                                            <p><strong>Arbiter:</strong> <span className="address-mono">{shortAddress(agg.arbiter)}</span></p>
                                        </div>
                                        <div className="item-actions">
                                            {/* Show Fund button if status is 'Created' and current user is the depositor */}
                                            {agg.status === 'Created' && agg.depositor.toLowerCase() === account.toLowerCase() && (
                                                <button onClick={() => handleAction(agg, 'Fund')} disabled={isLoading}>Fund Escrow</button>
                                            )}
                                            {/* Show Release button if status is 'Funded' and current user is the arbiter */}
                                            {agg.status === 'Funded' && agg.arbiter.toLowerCase() === account.toLowerCase() && (
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