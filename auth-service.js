const PAYMENT_CONFIG = {
    storeUrl: 'https://refine-ai.lemonsqueezy.com/',
    // LIVE: Lemon Squeezy checkout links
    pro: 'https://refine-ai.lemonsqueezy.com/checkout/buy/113b07ec-ff05-4e96-af18-d8865525482d',
    premium: 'https://refine-ai.lemonsqueezy.com/checkout/buy/faa13f51-3bc0-4b52-ae91-74575c0f1990',
    useDirectCheckout: true
};

const PLANS = {
    pro: { words_day: 20000, name: 'Pro Plan' },
    premium: { words_day: 1000000, name: 'Premium Plan' }
};

let currentUser = null;
let userProfile = null;

async function initAuth() {
    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }

    // Setup logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Setup user avatar dropdown toggle
    const avatarBtn = document.getElementById('user-avatar-btn');
    const userDropdown = document.getElementById('user-dropdown');
    if (avatarBtn && userDropdown) {
        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target) && !avatarBtn.contains(e.target)) {
                userDropdown.classList.remove('show');
            }
        });
    }

    // Show loading state while checking session
    const loadingView = document.getElementById('loading-view');

    // Check initial session
    try {
        const { data: { session } } = await window.supabase.auth.getSession();

        // Hide loading view
        if (loadingView) {
            loadingView.style.display = 'none';
        }

        if (session) {
            // User is logged in - go directly to main app
            handleUserAuth(session.user);
        } else {
            // User is not logged in - show auth screen
            showAuthUI(true);
        }
    } catch (err) {
        console.error('[RefineAI] Session check error:', err);
        // Hide loading, show auth on error
        if (loadingView) {
            loadingView.style.display = 'none';
        }
        showAuthUI(true);
    }

    // Listen for auth changes
    window.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            handleUserAuth(session.user);
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            userProfile = null;
            showAuthUI(true);
        }
    });
}

async function handleUserAuth(user) {
    // Reset login button loading state on success
    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) {
        loginBtn.classList.remove('loading');
    }

    currentUser = user;
    await fetchAndSyncProfile();
    updateUserProfileUI(user);
    showAuthUI(false);
}

function updateUserProfileUI(user) {
    if (!user) return;

    // Get user metadata
    const metadata = user.user_metadata || {};
    const avatarUrl = metadata.avatar_url || metadata.picture || 'icons/icon48.png';
    const fullName = metadata.full_name || metadata.name || 'User';
    const email = user.email || 'email@example.com';

    // Update avatar in header
    const avatarImg = document.getElementById('user-avatar-img');
    if (avatarImg) {
        avatarImg.src = avatarUrl;
        avatarImg.onerror = () => { avatarImg.src = 'icons/icon48.png'; };
    }

    // Update dropdown avatar
    const dropdownAvatar = document.getElementById('dropdown-avatar');
    if (dropdownAvatar) {
        dropdownAvatar.src = avatarUrl;
        dropdownAvatar.onerror = () => { dropdownAvatar.src = 'icons/icon48.png'; };
    }

    // Update name and email in dropdown
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = fullName;

    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = email;

    // Update settings account section
    const settingsAvatar = document.getElementById('settings-avatar');
    if (settingsAvatar) {
        settingsAvatar.src = avatarUrl;
        settingsAvatar.onerror = () => { settingsAvatar.src = 'icons/icon48.png'; };
    }

    const settingsName = document.getElementById('settings-user-name');
    if (settingsName) settingsName.textContent = fullName;

    const settingsEmail = document.getElementById('settings-user-email');
    if (settingsEmail) settingsEmail.textContent = email;

    // Update credit display
    updateCreditDisplay();

    // Re-initialize Lucide icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function updateCreditDisplay() {
    if (!userProfile) return;

    const wordsUsed = userProfile.words_used || 0;
    const dailyLimit = userProfile.daily_limit || window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT;

    // Delegate to the single source of truth for usage UI updates
    if (window.syncUsageUI) {
        window.syncUsageUI(wordsUsed, dailyLimit);
    }

    // Update footer text (only element syncUsageUI doesn't handle)
    const usageText = document.getElementById('usage-text');
    if (usageText) {
        usageText.textContent = `${wordsUsed.toLocaleString()} / ${dailyLimit.toLocaleString()} words`;
    }

    // Update footer progress bar
    const progressBar = document.getElementById('usage-bar');
    if (progressBar) {
        const percentage = Math.min((wordsUsed / dailyLimit) * 100, 100);
        progressBar.style.width = `${percentage}%`;
    }

    // Update plan badge with correct plan type
    const userPlan = document.getElementById('user-plan');
    if (userPlan) {
        const planType = userProfile.plan_type || 'free';
        const planName = planType.charAt(0).toUpperCase() + planType.slice(1);
        userPlan.textContent = planName;

        // Set appropriate class based on plan
        if (planType === 'premium') {
            userPlan.className = 'stat-value plan-badge premium';
        } else if (planType === 'pro') {
            userPlan.className = 'stat-value plan-badge pro';
        } else {
            userPlan.className = 'stat-value plan-badge free';
        }
    }

    // Hide/show upgrade button for paid users
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (upgradeBtn) {
        const planType = userProfile.plan_type || 'free';
        upgradeBtn.style.display = (planType === 'premium') ? 'none' : 'flex';
    }
}

async function handleLogout() {
    // Close the dropdown
    const userDropdown = document.getElementById('user-dropdown');
    if (userDropdown) userDropdown.classList.remove('show');

    try {
        const { error } = await window.supabase.auth.signOut();
        if (error) {
            console.error('[RefineAI] Logout error:', error);
            if (window.showToast) window.showToast('Logout failed. Please try again.', 'error');
        } else {
            if (window.showToast) window.showToast('Logged out successfully!', 'success');
        }
    } catch (err) {
        console.error('[RefineAI] Unexpected logout error:', err);
    }
}

function showAuthUI(show) {
    const authView = document.getElementById('auth-view');
    const mainContent = document.getElementById('app-main-content');
    if (!authView || !mainContent) {
        console.error('[RefineAI] Required elements not found!');
        return;
    }

    if (show) {
        // Show login screen
        authView.style.display = 'flex';
        authView.style.visibility = 'visible';
        authView.style.opacity = '1';
        mainContent.style.display = 'none';


        // Reset login button loading state
        const loginBtn = document.getElementById('google-login-btn');
        if (loginBtn) {
            loginBtn.classList.remove('loading');
        }

        // Initialize icons in auth view
        if (window.lucide) {
            setTimeout(() => window.lucide.createIcons(), 50);
        }
    } else {
        // Show main app
        authView.style.display = 'none';
        authView.style.visibility = 'hidden';
        authView.style.opacity = '0';
        mainContent.style.display = 'flex';
        mainContent.style.visibility = 'visible';


        // Force a reflow to ensure styles are applied
        mainContent.offsetHeight;

        // Re-initialize Lucide icons after showing content
        if (window.lucide) {
            setTimeout(() => {
                window.lucide.createIcons();
            }, 100);
        }
    }
}

async function handleLogin() {
    // Show loading state on button
    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) {
        loginBtn.classList.add('loading');
    }

    // Helper to hide loading
    const hideLoading = () => {
        if (loginBtn) {
            loginBtn.classList.remove('loading');
        }
    };

    // Get the extension's redirect URL
    const extensionRedirectUrl = chrome.identity.getRedirectURL();
    try {
        // 1. Get the Supabase Auth URL
        const { data, error } = await window.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                // This is a special URL Chrome provides for extensions
                redirectTo: extensionRedirectUrl,
                skipBrowserRedirect: true,
            }
        });

        if (error) {
            console.error('[RefineAI] OAuth initiation error:', error);
            if (window.showToast) window.showToast(`Login error: ${error.message}`, 'error');
            hideLoading();
            return;
        }

        if (!data || !data.url) {
            console.error('[RefineAI] No auth URL returned from Supabase');
            if (window.showToast) window.showToast('Failed to get login URL. Check Supabase configuration.', 'error');
            hideLoading();
            return;
        }

        // 2. Launch the secure Web Auth Flow
        chrome.identity.launchWebAuthFlow({
            url: data.url,
            interactive: true
        }, async (redirectUrl) => {
            // Handle errors from launchWebAuthFlow
            if (chrome.runtime.lastError) {
                const errorMsg = chrome.runtime.lastError.message;
                console.error('[RefineAI] Auth flow error:', errorMsg);

                // Provide more helpful error messages
                if (errorMsg.includes('canceled') || errorMsg.includes('cancelled')) {
                    if (window.showToast) window.showToast('Login cancelled by user.', 'warning');
                } else if (errorMsg.includes('redirect_uri_mismatch')) {
                    console.error('[RefineAI] REDIRECT URI MISMATCH! Add this URL to Google Cloud Console:', extensionRedirectUrl);
                    if (window.showToast) window.showToast('Redirect URI mismatch. Check console for details.', 'error');
                } else {
                    if (window.showToast) window.showToast(`Auth failed: ${errorMsg}`, 'error');
                }
                hideLoading();
                return;
            }

            if (!redirectUrl) {
                console.error('[RefineAI] No redirect URL received');
                if (window.showToast) window.showToast('Login failed: No response from auth server.', 'error');
                hideLoading();
                return;
            }
            // 3. Extract tokens from the redirect URL
            // Tokens can be in hash (#) or query (?) parameters
            let accessToken = null;
            let refreshToken = null;

            try {
                // Try hash fragment first (implicit grant flow)
                if (redirectUrl.includes('#')) {
                    const hashParams = new URLSearchParams(redirectUrl.split('#')[1]);
                    accessToken = hashParams.get('access_token');
                    refreshToken = hashParams.get('refresh_token');
                }

                // If not in hash, try query parameters (PKCE flow)
                if (!accessToken) {
                    const url = new URL(redirectUrl);
                    accessToken = url.searchParams.get('access_token');
                    refreshToken = url.searchParams.get('refresh_token');

                    // Check for authorization code (PKCE)
                    const code = url.searchParams.get('code');
                    if (code && !accessToken) {
                        const { data: sessionData, error: exchangeError } = await window.supabase.auth.exchangeCodeForSession(code);

                        if (exchangeError) {
                            console.error('[RefineAI] Code exchange error:', exchangeError);
                            if (window.showToast) window.showToast('Failed to exchange code for session.', 'error');
                            return;
                        }

                        if (sessionData && sessionData.session) {
                            return; // Session is already set by exchangeCodeForSession
                        }
                    }
                }

                // Check for error in URL
                const errorDescription = new URLSearchParams(redirectUrl.includes('#') ? redirectUrl.split('#')[1] : new URL(redirectUrl).search).get('error_description');
                if (errorDescription) {
                    console.error('[RefineAI] OAuth error:', errorDescription);
                    if (window.showToast) window.showToast(`OAuth error: ${errorDescription}`, 'error');
                    hideLoading();
                    return;
                }

            } catch (parseError) {
                console.error('[RefineAI] Error parsing redirect URL:', parseError);
            }

            if (accessToken && refreshToken) {
                const { error: sessionError } = await window.supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken
                });

                if (sessionError) {
                    console.error('[RefineAI] Session error:', sessionError);
                    if (window.showToast) window.showToast(`Session error: ${sessionError.message}`, 'error');
                    hideLoading();
                } else {
                    // Auth state change will handle the rest
                }
            } else {
                console.error('[RefineAI] No tokens found in redirect URL');
                if (window.showToast) window.showToast('Login failed: No tokens received.', 'error');
                hideLoading();
            }
        });
    } catch (err) {
        console.error('[RefineAI] Unexpected login error:', err);
        if (window.showToast) window.showToast('Login failed unexpectedly. Check console.', 'error');
        hideLoading();
    }
}

async function fetchAndSyncProfile() {
    if (!currentUser) return;

    try {
        const { data, error } = await window.supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
        if (error && (error.code === 'PGRST116' || error.code === '406')) {
            // Profile doesn't exist, create it
            const { data: newProfile, error: createError } = await window.supabase
                .from('profiles')
                .insert([{
                    id: currentUser.id,
                    email: currentUser.email,
                    words_used: 0,
                    daily_limit: window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT,
                    last_reset_date: new Date().toISOString().split('T')[0]
                }])
                .select()
                .single();

            if (createError) {
                console.error('[RefineAI] Error creating profile:', createError);
                // Use default profile if creation fails (likely RLS issue)
                userProfile = {
                    id: currentUser.id,
                    email: currentUser.email,
                    words_used: 0,
                    daily_limit: window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT,
                    last_reset_date: new Date().toISOString().split('T')[0]
                };
            } else {
                userProfile = newProfile;
            }
        } else if (error) {
            console.error('[RefineAI] Error fetching profile:', error);
            // Use default profile on any error
            userProfile = {
                id: currentUser.id,
                email: currentUser.email,
                words_used: 0,
                daily_limit: window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT,
                last_reset_date: new Date().toISOString().split('T')[0]
            };
        } else {
            userProfile = data;
            // Simple client-side reset check
            const today = new Date().toISOString().split('T')[0];
            if (userProfile && userProfile.last_reset_date !== today) {
                userProfile.words_used = 0;
                userProfile.last_reset_date = today;
                await updateProfileOnDB({ words_used: 0, last_reset_date: today });
            }
        }
    } catch (err) {
        console.error('[RefineAI] Unexpected error in fetchAndSyncProfile:', err);
        // Use default profile on error
        userProfile = {
            id: currentUser.id,
            email: currentUser.email,
            words_used: 0,
            daily_limit: window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT,
            last_reset_date: new Date().toISOString().split('T')[0]
        };
    }

    // Safely sync UI
    if (userProfile && window.syncUsageUI) {
        window.syncUsageUI(userProfile.words_used || 0, userProfile.daily_limit || window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT);
    }
}

async function updateProfileOnDB(updates) {
    if (!currentUser) return;
    const { error } = await window.supabase
        .from('profiles')
        .update(updates)
        .eq('id', currentUser.id);

    if (error) console.error('Error updating profile:', error);
}

async function checkLimit(wordCount) {
    if (!userProfile) return false;

    // Estimate total cost: input + ~1.5x output multiplier
    const estimatedTotal = Math.ceil(wordCount * window.REFINE_CONFIG.LIMIT_MULTIPLIER);
    if (userProfile.words_used + estimatedTotal > userProfile.daily_limit) {
        return false; // Limit would be exceeded
    }
    return true;
}

async function incrementWordCount(count) {
    if (!userProfile) return;

    const newCount = userProfile.words_used + count;
    userProfile.words_used = newCount;

    await updateProfileOnDB({ words_used: newCount });
    if (window.syncUsageUI) window.syncUsageUI(newCount, userProfile.daily_limit);
}

// ==========================================
// PAYMENT INTEGRATION
// ==========================================




async function initiatePayment(planType) {
    if (!currentUser) {
        if (window.showToast) window.showToast('Please login first', 'error');
        return;
    }

    // Build checkout URL
    let checkoutUrl = PAYMENT_CONFIG[planType];
    const url = new URL(checkoutUrl);

    // Pass user identity using Lemon Squeezy's official parameter format
    // 'passthrough' is the most reliable fallback for webhooks
    url.searchParams.set('checkout[email]', currentUser.email);
    url.searchParams.set('checkout[custom][user_id]', currentUser.id);
    url.searchParams.set('checkout[passthrough]', currentUser.id);
    url.searchParams.set('passthrough', currentUser.id);

    // Open payment page
    const width = 550;
    const height = 700;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;

    const popup = window.open(
        url.toString(),
        'RefineAI Payment',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );

    if (!popup) {
        window.open(url.toString(), '_blank');
        if (window.showToast) window.showToast('Opening payment page...', 'info');
        return;
    }

    if (window.showToast) window.showToast('Complete your payment in the new window', 'info');

    // Proactive Polling: 
    // Capture state BEFORE we open the window
    let currentBasePlan = userProfile?.plan_type || 'free';
    let isFinalized = false;

    const checkPopup = setInterval(async () => {
        // Fallback: If user closed it manually
        if (popup.closed && !isFinalized) {
            clearInterval(checkPopup);
            await finalizeUpgrade();
            return;
        }

        // Proactive sync while open
        try {
            await fetchAndSyncProfile();
            const dbPlan = userProfile?.plan_type || 'free';

            // Only trigger if IT ACTUALLY CHANGED to the one we wanted
            if (dbPlan !== currentBasePlan && dbPlan === planType && !isFinalized) {
                isFinalized = true;
                clearInterval(checkPopup);
                popup.close();
                await finalizeUpgrade();
            }
        } catch (e) {
            console.error('[RefineAI] Polling error:', e);
        }
    }, 2000);

    async function finalizeUpgrade() {
        // Small delay to ensure webhook completes
        await new Promise(resolve => setTimeout(resolve, 2000));

        await fetchAndSyncProfile();
        updateUserProfileUI(currentUser);
        updateUpgradeView();

        // Update words display in the footer circle
        if (window.syncUsageUI && userProfile) {
            window.syncUsageUI(userProfile.words_used || 0, userProfile.daily_limit || window.REFINE_CONFIG.DEFAULT_DAILY_LIMIT);
        }

        // Show Success Modal
        showSuccessModal();

        if (window.lucide) window.lucide.createIcons();
    }
}

function showSuccessModal() {
    const modal = document.getElementById('success-modal');
    const closeBtn = document.getElementById('success-close-btn');
    const message = document.getElementById('success-modal-message');

    if (modal && userProfile) {
        const planName = userProfile.plan_type.charAt(0).toUpperCase() + userProfile.plan_type.slice(1);
        if (message) {
            message.textContent = `Your RefineAI ${planName} is now active. Enjoy your unlimited writing powers!`;
        }

        modal.style.display = 'flex';

        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.style.display = 'none';
                // Switch view back to main after closing modal
                const goHomeBtn = document.getElementById('go-home') || document.getElementById('back-btn');
                if (goHomeBtn) {
                    // Force navigation to home
                    const views = document.querySelectorAll('.view');
                    views.forEach(v => v.classList.remove('active'));
                    const mainView = document.getElementById('main-view');
                    if (mainView) mainView.classList.add('active');

                    // Hide sub-header if visible
                    const subHeader = document.getElementById('sub-header');
                    if (subHeader) subHeader.style.display = 'none';
                }
            };
        }

        if (window.lucide) window.lucide.createIcons();
    }
}

function updateUpgradeView() {
    const currentPlanValue = document.getElementById('current-plan-value');
    const proCard = document.getElementById('pro-card');
    const premiumCard = document.getElementById('premium-card');
    const proBtn = document.getElementById('upgrade-pro-btn');
    const premiumBtn = document.getElementById('upgrade-premium-btn');

    if (!userProfile) return;

    const currentPlan = userProfile.plan_type || 'free';

    // Update current plan banner
    if (currentPlanValue) {
        currentPlanValue.textContent = currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1);
    }

    // Update Pro card
    if (proCard && proBtn) {
        if (currentPlan === 'pro' || currentPlan === 'premium') {
            proCard.classList.add('active');
            proBtn.innerHTML = '<i data-lucide="check"></i><span>Current Plan</span>';
            proBtn.disabled = true;
        } else {
            proCard.classList.remove('active');
            proBtn.innerHTML = '<i data-lucide="zap"></i><span>Upgrade to Pro</span>';
            proBtn.disabled = false;
        }
    }

    // Update Premium card
    if (premiumCard && premiumBtn) {
        if (currentPlan === 'premium') {
            premiumCard.classList.add('active');
            premiumBtn.innerHTML = '<i data-lucide="check"></i><span>Current Plan</span>';
            premiumBtn.disabled = true;
        } else {
            premiumCard.classList.remove('active');
            premiumBtn.innerHTML = '<i data-lucide="crown"></i><span>Go Premium</span>';
            premiumBtn.disabled = false;
        }
    }

    // Re-initialize Lucide icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Setup payment buttons
function setupPaymentButtons() {
    const proBtn = document.getElementById('upgrade-pro-btn');
    const premiumBtn = document.getElementById('upgrade-premium-btn');

    if (proBtn) {
        proBtn.addEventListener('click', () => initiatePayment('pro'));
    }

    if (premiumBtn) {
        premiumBtn.addEventListener('click', () => initiatePayment('premium'));
    }
}



window.authService = {
    init: initAuth,
    checkLimit,
    incrementWordCount,
    initiatePayment,
    updateUpgradeView,
    setupPaymentButtons,
    getCurrentUserId: () => currentUser?.id || null,
    getCurrentUser: () => currentUser,
    getUserProfile: () => userProfile
};

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    setupPaymentButtons();
});

