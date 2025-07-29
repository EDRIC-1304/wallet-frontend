/* eslint-env browser, node */
import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import axios from 'axios';
import QRCode from 'react-qr-code';
import './appln.css'; // Using the new CSS file

// --- NEW: Define your backend URL as a constant ---
const BACKEND_URL = 'https://wallet-backend-lzzw.onrender.com';

// --- Contract Addresses and ABI remain the same ---
const USDT_CONTRACT_ADDRESS = '0x787A697324dbA4AB965C58CD33c13ff5eeA6295F';
const USDC_CONTRACT_ADDRESS = '0x342e3aA1248AB77E319e3331C6fD3f1F2d4B36B1';
const ABI = ["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint amount) returns (bool)"];

function Appln() {
  // --- All state variables remain the same ---
  const [walletName, setWalletName] = useState('');
  const [password, setPassword] = useState('');
  const [wallet, setWallet] = useState(null);
  const [privateKey, setPrivateKey] = useState('');
  // --- NEW: State for revealing mnemonic ---
  const [mnemonic, setMnemonic] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [selectedToken, setSelectedToken] = useState('BNB');
  const [bnb, setBNB] = useState('0');
  const [usdt, setUSDT] = useState('0');
  const [usdc, setUSDC] = useState('0');
  const [view, setView] = useState('send');
  const [txHash, setTxHash] = useState('');
  const [popup, setPopup] = useState('');
  const [ledger, setLedger] = useState([]);
  const [disableSend, setDisableSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingTxs, setPendingTxs] = useState([]);
  const [cancellingTxHash, setCancellingTxHash] = useState(null);

  // --- All functions (provider, showPopup, updateBalances, etc.) remain exactly the same ---
  const provider = new ethers.JsonRpcProvider("https://data-seed-prebsc-1-s1.binance.org:8545");

  const showPopup = (msg) => {
    setPopup(msg);
    setTimeout(() => setPopup(''), 3500);
  };

  const updateBalances = useCallback(async (address) => {
    try {
      const b = await provider.getBalance(address);
      setBNB(ethers.formatEther(b));
      const usdtC = new ethers.Contract(USDT_CONTRACT_ADDRESS, ABI, provider);
      const usdtB = await usdtC.balanceOf(address);
      setUSDT(ethers.formatUnits(usdtB, 18));
      const usdcC = new ethers.Contract(USDC_CONTRACT_ADDRESS, ABI, provider);
      const usdcB = await usdcC.balanceOf(address);
      setUSDC(ethers.formatUnits(usdcB, 18));
    } catch (error) {
      console.error("Failed to update balances:", error);
      showPopup("❌ Could not fetch balances.");
    }
  }, []); // Removed provider from dependency array as it's stable

  useEffect(() => {
    if (wallet?.address) {
      updateBalances(wallet.address);
      // Clear sensitive info on new wallet load
      setPrivateKey('');
      setMnemonic('');
    }
  }, [wallet, updateBalances]);

  const generateWallet = async () => {
    if (!walletName || !password) return showPopup("Enter a wallet name and password to create.");
    const newWallet = ethers.Wallet.createRandom();
    const encryptedJson = await newWallet.encrypt(password);
    try {
      // --- CHANGE 1: Using the backend URL ---
      await axios.post(`${BACKEND_URL}/api/wallets`, {
        userId: 'user001',
        username: walletName,
        address: newWallet.address,
        mnemonic: newWallet.mnemonic.phrase,
        encryptedJson
      });
      setWallet({ ...newWallet, encryptedJson, name: walletName });
      showPopup("✅ Wallet created successfully!");
    } catch {
      showPopup("❌ Error creating wallet. Name might be taken.");
    }
  };

  const findWallet = async () => {
    if (!walletName) return showPopup("Enter wallet name to fetch.");
    try {
      // --- CHANGE 2: Using the backend URL ---
      const res = await axios.get(`${BACKEND_URL}/api/wallets/${walletName}`);
      const found = res.data;
      setWallet({
        name: found.username,
        address: found.address,
        mnemonic: { phrase: found.mnemonic },
        encryptedJson: found.encryptedJson
      });
      updateBalances(found.address);
      showPopup("✅ Wallet fetched successfully!");
    } catch {
      showPopup("❌ Wallet not found.");
    }
  };

  const revealPrivateKey = async () => {
    if (!wallet || !password) return showPopup("Enter password to reveal key.");
    try {
      const dec = await ethers.Wallet.fromEncryptedJson(wallet.encryptedJson, password);
      setPrivateKey(dec.privateKey);
    } catch {
      showPopup("❌ Wrong password.");
    }
  };
  
  // --- NEW: Function to reveal the mnemonic phrase securely ---
  const revealMnemonic = async () => {
    if (!wallet || !password) return showPopup("Enter password to reveal mnemonic.");
    try {
      // Verify password by attempting decryption, but don't need the result
      await ethers.Wallet.fromEncryptedJson(wallet.encryptedJson, password);
      // If decryption is successful, the password is correct. Now reveal mnemonic.
      setMnemonic(wallet.mnemonic.phrase);
    } catch {
      showPopup("❌ Wrong password.");
    }
  };

  const sendToken = async () => {
    if (!wallet || !password || !recipientAddress || !amount) {
      return showPopup("❌ Please fill all fields to send.");
    }
    setDisableSend(true);
    setSending(true);
    let tx;
    try {
      const dec = await ethers.Wallet.fromEncryptedJson(wallet.encryptedJson, password);
      const connected = dec.connect(provider);
      let contractAddress;
      if (selectedToken === "USDT") {
        contractAddress = USDT_CONTRACT_ADDRESS;
      } else if (selectedToken === "USDC") {
        contractAddress = USDC_CONTRACT_ADDRESS;
      }
  
      if (selectedToken === "BNB") {
        tx = await connected.sendTransaction({ to: recipientAddress, value: ethers.parseEther(amount) });
      } else {
        const contract = new ethers.Contract(contractAddress, ABI, connected);
        tx = await contract.transfer(recipientAddress, ethers.parseUnits(amount, 18));
      }
  
      setTxHash(tx.hash);
      const pendingTxData = { hash: tx.hash, amount, token: selectedToken, to: recipientAddress };
      setPendingTxs(prev => [...prev, pendingTxData]);
      showPopup("⏳ Transaction Submitted! Awaiting confirmation...");
      await tx.wait();
      try {
        // --- CHANGE 3: Using the backend URL ---
        await axios.post(`${BACKEND_URL}/api/transactions/record`, { txHash: tx.hash });
        showPopup("✅ Transaction Confirmed & Recorded!");
      } catch (error) {
        console.error("Ledger recording failed:", error);
        showPopup("✅ Tx Confirmed, but failed to record in ledger.");
      }
      updateBalances(await connected.getAddress());
    } catch (err) {
      console.error(err);
      showPopup("❌ Transaction Failed or was Rejected.");
    } finally {
      if (tx) setPendingTxs(prev => prev.filter(p => p.hash !== tx.hash));
      setSending(false);
      setDisableSend(false);
    }
  };
  
  const handleCancelTransaction = async (stuckTxHash) => {
    if (!wallet || !password) return showPopup("❌ Enter password to sign cancellation.");
    setCancellingTxHash(stuckTxHash);
    showPopup("🔍 Checking transaction status...");
    try {
      const receipt = await provider.getTransactionReceipt(stuckTxHash);
      if (receipt && receipt.blockNumber) {
        showPopup("✅ Transaction has already been confirmed!");
        setPendingTxs(prev => prev.filter(p => p.hash !== stuckTxHash));
        updateBalances(wallet.address);
        return;
      }
      const decryptedWallet = await ethers.Wallet.fromEncryptedJson(wallet.encryptedJson, password);
      const connectedWallet = decryptedWallet.connect(provider);
      const stuckTx = await provider.getTransaction(stuckTxHash);
      if (!stuckTx) throw new Error("Transaction not found.");
      const newGasPrice = stuckTx.gasPrice * BigInt(120) / BigInt(100);
      showPopup("Gas price increased. Submitting cancellation...");
      const cancelTx = await connectedWallet.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("0"),
        nonce: stuckTx.nonce,
        gasPrice: newGasPrice,
      });
      showPopup("⏳ Submitting cancellation... Awaiting confirmation.");
      await cancelTx.wait();
      setPendingTxs(prev => prev.filter(p => p.hash !== stuckTxHash));
      showPopup(`✅ Original transaction successfully cancelled with new Tx: ${cancelTx.hash}`);
    } catch (err) {
      console.error("Cancellation failed:", err);
      if (err.message.includes("not found")) {
        showPopup("❌ Cancellation failed. The transaction was likely already processed.");
        setPendingTxs(prev => prev.filter(p => p.hash !== stuckTxHash));
        updateBalances(wallet.address);
      } else {
        showPopup(`❌ Cancellation failed: ${err.message}`);
      }
    } finally {
      setCancellingTxHash(null);
    }
  };

  const fetchLedger = async () => {
    if (!wallet?.address) return;
    try {
      // --- CHANGE 4: Using the backend URL ---
      const res = await axios.get(`${BACKEND_URL}/api/transactions/${wallet.address}`);
      setLedger(res.data);
    } catch {
      setLedger([]);
    }
  };

  // --- JSX STRUCTURE REMAINS THE SAME ---
  return (
    <div className="wallet-manager-container">
      <div className="header">
        <h1>REACT WALLET</h1>
      </div>

      <div className="card-grid">
        {/* --- LEFT COLUMN --- */}
        <div className="card-column">
          <div className="wallet-card">
            <h3>Find or Create a Wallet</h3>
            <div className="input-group">
              <input
                placeholder="Enter Wallet Name (e.g., 'MyProWallet')"
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
                className="wallet-input"
              />
              {/* --- FIX 1: Password input moved here and is always visible --- */}
              <input
                  type="password"
                  placeholder="Enter Password for Wallet"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="wallet-input"
              />
              <div className="button-row">
                <button className="btn btn-primary" onClick={generateWallet}>Create</button>
                <button className="btn btn-secondary" onClick={findWallet}>Fetch</button>
              </div>
            </div>
          </div>

          {wallet && view === 'send' && (
            <div className="wallet-card">
              <h3>Send Tokens</h3>
              <input
                placeholder="Recipient Address"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                className="wallet-input"
              />
              <div className="amount-group">
                <input
                  placeholder="Amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="wallet-input amount-input"
                />
                <select value={selectedToken} onChange={(e) => setSelectedToken(e.target.value)} className="wallet-select">
                  <option value="BNB">BNB</option>
                  <option value="USDT">USDT</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>
              <button onClick={sendToken} className="btn btn-primary btn-full" disabled={disableSend || sending}>
                {sending ? "Sending..." : "Send Transaction"}
              </button>
            </div>
          )}
        </div>

        {/* --- RIGHT COLUMN --- */}
        <div className="card-column">
          <div className="wallet-card">
            {wallet ? (
              <div>
                <h3>{wallet.name} Details</h3>
                <p className="wallet-address"><strong>Address:</strong> {wallet.address}</p>
                <div className="balances">
                  <p><strong>BNB:</strong> {parseFloat(bnb).toFixed(4)}</p>
                  <p><strong>USDT:</strong> {parseFloat(usdt).toFixed(2)}</p>
                  <p><strong>USDC:</strong> {parseFloat(usdc).toFixed(2)}</p>
                </div>
                {/* --- FIX 2: Added buttons and display for Mnemonic and Private Key --- */}
                <div className="button-row">
                    <button className="btn btn-secondary btn-full" onClick={revealMnemonic}>Reveal Mnemonic</button>
                    <button className="btn btn-secondary btn-full" onClick={revealPrivateKey}>Reveal Private Key</button>
                </div>
                {mnemonic && <p className="private-key"><strong>Mnemonic:</strong> {mnemonic}</p>}
                {privateKey && <p className="private-key"><strong>PK:</strong> {privateKey}</p>}

                <div className="view-buttons">
                  <button className={`btn-view ${view === 'send' ? 'active' : ''}`} onClick={() => setView('send')}>Send</button>
                  <button className={`btn-view ${view === 'receive' ? 'active' : ''}`} onClick={() => setView('receive')}>Receive</button>
                  <button className={`btn-view ${view === 'ledger' ? 'active' : ''}`} onClick={() => { setView('ledger'); fetchLedger(); }}>Ledger</button>
                </div>
              </div>
            ) : (
              <div className="no-wallet-loaded">
                <h3>No Wallet Loaded</h3>
                <p>Please create a new wallet or fetch an existing one to begin.</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* --- Conditional Full-Width Cards --- */}
      {view === 'receive' && wallet && (
        <div className="wallet-card full-width-card">
          <h3>Receive Funds</h3>
          <div className="receive-content">
            <div className="qr-code-bg">
              <QRCode value={wallet.address} size={160} bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p><strong>Your Wallet Address:</strong></p>
            <code className="wallet-address-code">{wallet.address}</code>
            <button className="btn btn-secondary" onClick={() => { navigator.clipboard.writeText(wallet.address); showPopup("📋 Address Copied") }}>
              Copy Address
            </button>
          </div>
        </div>
      )}

      {pendingTxs.length > 0 && (
          <div className="wallet-card full-width-card">
              <h3>Pending Transactions</h3>
              <div className="ledger-list">
                  {pendingTxs.map(tx => (
                      <div key={tx.hash} className="ledger-item pending-item">
                          <p><strong>Sending:</strong> {tx.amount} {tx.token} to {tx.to.substring(0, 10)}...</p>
                          <div className="pending-details">
                              <div className="spinner"></div>
                              <span>Pending...</span>
                              <a href={`https://testnet.bscscan.com/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="appln-link">View on BscScan</a>
                              <button className="btn-cancel" onClick={() => handleCancelTransaction(tx.hash)} disabled={cancellingTxHash === tx.hash}>
                                  {cancellingTxHash === tx.hash ? '...' : 'Cancel'}
                              </button>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {view === 'ledger' && wallet && (
        <div className="wallet-card full-width-card">
          <h3>Transaction Ledger</h3>
          <div className="ledger-list">
            {ledger.length === 0 ? <p>No transactions found for this address.</p> : ledger.map((tx, i) => (
              <div key={i} className="ledger-item">
                <p><strong>From:</strong> {tx.from}</p>
                <p><strong>To:</strong> {tx.to}</p>
                <p><strong>Amount:</strong> {tx.amount} {tx.token}</p>
                <p><strong>Gas Fee:</strong> {tx.gasFee} BNB</p>
                <p><strong>Time:</strong> {new Date(tx.timestamp).toLocaleString()}</p>
                <a href={`https://testnet.bscscan.com/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer" className="appln-link">View on BscScan</a>
              </div>
            ))}
          </div>
        </div>
      )}

      {popup && <div className="wallet-popup">{popup}</div>}
    </div>
  );
}

export default Appln;