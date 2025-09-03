import { LitElement, html, css } from 'lit';

// Separate DiffViewer Web Component for isolated diff rendering
class DiffViewer extends LitElement {
    static properties = {
        patch: { type: String },
        loading: { type: Boolean }
    };

    static styles = css`
        :host {
            display: block;
            width: 100%;
            background: #0d1117;
            overflow: hidden;
        }

        #diff-container {
            width: 100%;
            height: 400px;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
            background: #0d1117;
            color: #f0f6fc;
        }

        /* Dark theme overrides for diff2html */
        #diff-container .d2h-wrapper {
            background: #0d1117 !important;
            color: #f0f6fc !important;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
        }

        #diff-container .d2h-file-header {
            background: #21262d !important;
            border-bottom: 1px solid #30363d !important;
            color: #f0f6fc !important;
            padding: 10px;
            font-weight: bold;
        }

        #diff-container .d2h-file-list-wrapper {
            background: #0d1117 !important;
        }

        #diff-container .d2h-file-list-header {
            background: #21262d !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-file-list-title {
            color: #f0f6fc !important;
        }

        #diff-container .d2h-file-list-line {
            background: #0d1117 !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-code-line {
            display: table !important;
            width: 100% !important;
            background: #0d1117 !important;
            color: #f0f6fc !important;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
            font-size: 12px;
            line-height: 1.4;
        }

        #diff-container .d2h-code-side-line {
            display: table !important;
            width: 100% !important;
            background: #0d1117 !important;
            color: #f0f6fc !important;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
            font-size: 12px;
            line-height: 1.4;
        }

        /* Dark theme line numbers */
        #diff-container .d2h-code-linenumber,
        #diff-container .d2h-code-side-linenumber {
            background-color: #21262d !important;
            border-right: 1px solid #30363d !important;
            color: #7d8590 !important;
            display: table-cell !important;
            width: 50px !important;
            min-width: 50px !important;
            padding: 0 8px !important;
            text-align: right !important;
            vertical-align: top !important;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace !important;
            font-size: 11px !important;
            user-select: none !important;
            position: static !important;
            z-index: auto !important;
        }

        /* Dark theme content cells */
        #diff-container .d2h-code-line-ctn {
            background: #0d1117 !important;
            color: #f0f6fc !important;
            display: table-cell !important;
            padding: 0 8px !important;
            vertical-align: top !important;
            white-space: pre-wrap !important;
            word-break: break-all !important;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace !important;
            font-size: 12px !important;
            line-height: 1.4 !important;
        }

        /* Dark theme diff colors */
        #diff-container .d2h-ins {
            background-color: #033a16 !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-ins .d2h-code-line-ctn {
            background-color: #033a16 !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-del {
            background-color: #67060c !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-del .d2h-code-line-ctn {
            background-color: #67060c !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-cntx {
            background-color: #0d1117 !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-info {
            background-color: #1f2328 !important;
            color: #f0f6fc !important;
        }

        #diff-container .d2h-moved {
            background-color: #1f2328 !important;
            color: #f0f6fc !important;
        }

        /* Dark theme table structure */
        #diff-container table {
            width: 100% !important;
            border-collapse: collapse !important;
            table-layout: fixed !important;
            background: #0d1117 !important;
        }

        #diff-container tbody {
            display: table-row-group !important;
            background: #0d1117 !important;
        }

        #diff-container tr {
            display: table-row !important;
            background: #0d1117 !important;
        }

        #diff-container td {
            display: table-cell !important;
            vertical-align: top !important;
            border: none !important;
            background: inherit !important;
        }

        /* Fix diff2html line structure and borders */
        #diff-container .d2h-file-diff {
            border-radius: 0 0 6px 6px;
            background: #0d1117 !important;
        }

        #diff-container .d2h-code-line-prefix,
        #diff-container .d2h-code-line-ctn {
            display: table-cell !important;
            vertical-align: top !important;
        }

        #diff-container .d2h-code-line-prefix {
            width: 40px;
            min-width: 40px;
            text-align: right;
            padding: 0 8px;
            border-right: 1px solid #30363d !important;
            background-color: #21262d !important;
            color: #7d8590 !important;
            font-family: 'Consolas', 'Monaco', 'Lucida Console', monospace;
            font-size: 12px;
            line-height: 1.4;
        }

        /* Loading spinner styles */
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px;
            color: #f0f6fc;
            background: #0d1117;
        }

        .spinner {
            border: 3px solid #30363d;
            border-top: 3px solid var(--spectrum-blue-600, #0066cc);
            border-radius: 50%;
            width: 32px;
            height: 32px;
            animation: spin 1s linear infinite;
            margin-bottom: 16px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Prevent overlay positioning */
        #diff-container * {
            position: static !important;
            z-index: auto !important;
        }
    `;

    constructor() {
        super();
        this.patch = '';
        this.cssLoaded = false;
        this.loading = false;
    }

    async firstUpdated() {
        // Load diff2html CSS into this component's Shadow DOM
        await this.loadDiff2HtmlCSS();
    }

    async loadDiff2HtmlCSS() {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = 'text/css';
            link.href = 'https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css';
            link.onload = () => {
                this.cssLoaded = true;
                resolve();
            };
            link.onerror = (err) => reject(err);
            this.shadowRoot.appendChild(link);
        });
    }

    updated(changedProperties) {
        if (changedProperties.has('patch')) {
            this.renderDiff();
        }
    }

    async renderDiff() {
        // Wait for both the component's CSS to load and the Diff2Html library to be ready.
        if (!this.cssLoaded || typeof window.Diff2Html === 'undefined') {
            // If either is not ready, wait a bit and retry.
            setTimeout(() => this.renderDiff(), 100);
            return;
        }

        const diffContainer = this.shadowRoot.getElementById('diff-container');
        if (!diffContainer) {
            console.error('Diff container not found');
            return;
        }

        // Clear previous diff
        while (diffContainer.firstChild) {
            diffContainer.removeChild(diffContainer.firstChild);
        }

        if (this.loading) {
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'loading-container';
            loadingIndicator.innerHTML = `
                <div class="spinner"></div>
                <p>Generating configuration preview...</p>
            `;
            diffContainer.appendChild(loadingIndicator);
            return;
        }

        // Only render if CSS is loaded and patch is available
        if (!this.cssLoaded || !this.patch) {
            return;
        }

        // Use diff2html to parse the patch and generate HTML
        const diffJson = window.Diff2Html.parse(this.patch);
        const diffHtml = window.Diff2Html.html(diffJson, {
            drawFileList: true,
            outputFormat: 'line-by-line',
            matching: 'lines',
            renderNothingWhenEmpty: true,
        });

        // Create a temporary container to sanitize the HTML
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = diffHtml;

        // Force static positioning to fix display issues
        Array.from(tempContainer.querySelectorAll('*')).forEach(el => {
            el.style.position = 'static';
        });

        // Append sanitized and adjusted HTML
        diffContainer.appendChild(tempContainer);
    }

    render() {
        return html`
            <div id="diff-container" class="diff-container-dark">
                <!-- Diff content will be rendered here -->
            </div>
        `;
    }
}

if (!customElements.get('diff-viewer')) {
    customElements.define('diff-viewer', DiffViewer);
}

export class SetupWizard extends LitElement {
    static properties = {
        currentStep: { type: Number },
        accessToken: { type: String },
        token: { type: String },
        tokenValid: { type: Boolean },
        loading: { type: Boolean },
        error: { type: String },
        advancedSettings: { type: Object },
        previewData: { type: Object },
        healthChecks: { type: Array },
        toastMessage: { type: String },
        toastVariant: { type: String },
        showToast: { type: Boolean },
        aioConfigFile: { type: Object },
        aioConfigContent: { type: String },
        processingAioConfig: { type: Boolean },
        gitInfo: { type: Object },
        generatedApiKey: { type: String },
        org: { type: String },
        site: { type: String },
        availableSites: { type: Array },
        loadingSites: { type: Boolean },
        allowManualSiteEntry: { type: Boolean },
        aioNamespace: { type: String },
        aioAuth: { type: String }
    };

    static styles = css`
        :host {
            display: block;
            margin: 20px;
            --toast-negative-bg: #D13241;
            --toast-positive-bg: #218739;
        }
        .container {
            max-width: 900px;
            margin: auto;
            padding: 24px;
            background-color: #1e1e1e;
            border-radius: 8px;
        }
        .title {
            font-size: 28px;
            font-weight: bold;
            color: #ffffff;
            text-align: center;
            margin-bottom: 20px;
        }
        .wizard-container {
            display: flex;
            flex-direction: column;
            gap: 24px;
            padding: 24px;
            background-color: #2b2b2b;
            border-radius: 8px;
            border: 1px solid #444;
        }
        .step-indicator {
            display: flex;
            justify-content: center;
            align-items: center;
            margin-bottom: 24px;
            gap: 8px;
        }
        .step {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background-color: #3a3a3a;
            color: #cccccc;
            font-size: 14px;
            font-weight: bold;
            border: 2px solid transparent;
            transition: all 0.3s ease;
        }
        .step.active {
            border-color: #0078d4;
            background-color: #0078d4;
            color: #ffffff;
        }
        .step.completed {
            background-color: #107c10;
            color: #ffffff;
            border-color: #107c10;
        }
        .step-connector {
            flex-grow: 1;
            height: 2px;
            background-color: #3a3a3a;
        }
        .step-content {
            background-color: #242424;
            padding: 24px;
            border-radius: 8px;
            border: 1px solid #333333;
            min-height: 350px;
            max-height: 600px;
            overflow-y: auto;
        }
        .button-group {
            display: flex;
            justify-content: space-between;
            margin-top: 24px;
        }
        .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .full-span {
            grid-column: 1 / -1;
        }
        .full-width-section {
            width: 100%;
            margin-bottom: 32px;
        }
        .centered-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
        }
        .token-field-container {
            width: 100%;
        }

        .browse-button {
            padding: 12px 24px;
            background-color: #0078d4;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .browse-button:hover {
            background-color: #106ebe;
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }

        .browse-button:active {
            background-color: #005a9e;
            transform: translateY(0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
            max-width: 600px;
            margin: 0 auto;
        }
        .dropzone-section {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
        }
        .health-check-container {
            margin-top: 24px;
        }
        .toast-notification {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            border-radius: 6px;
            color: white;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 1000;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            opacity: 0;
            transition: opacity 0.3s ease, bottom 0.3s ease;
        }
        .toast-notification.visible {
            opacity: 1;
            bottom: 30px;
        }
        .toast-close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
        }
    `;

    constructor() {
        super();
        this.currentStep = 1;
        this.accessToken = '';
        this.token = '';
        this.tokenValid = false;
        this.loading = false;
        this.error = '';
        this.advancedSettings = {
            productPageUrlFormat: '/products/{urlKey}/{sku}',
            contentUrl: '',
            productsTemplate: '',
            storeUrl: '',
            configName: 'config',
            locales: null
        };
        this.previewData = null;
        this.healthChecks = [];
        this.toastMessage = '';
        this.toastVariant = 'negative';
        this.showToast = false;
        this.aioConfigFile = null;
        this.aioConfigContent = '';
        this.processingAioConfig = false;
        this.gitInfo = null;
        this.generatedApiKey = '';
        this.org = '';
        this.site = '';
        this.availableSites = [];
        this.loadingSites = false;
        this.allowManualSiteEntry = false;
    }

    updateUrlsFromSelection() {
        if (this.org && this.site) {
            const baseUrl = `https://main--${this.site}--${this.org}.aem.live`;
            this.advancedSettings = {
                ...this.advancedSettings,
                contentUrl: baseUrl,
                storeUrl: baseUrl,
                productsTemplate: `${baseUrl}/products/default`,
            };
        }
    }

    handleOrgChange(e) {
        this.org = e.target.value;
        this.updateUrlsFromSelection();
    }

    handleSiteChange(e) {
        this.site = e.target.value;
        this.updateUrlsFromSelection();
    }


    connectedCallback() {
        super.connectedCallback();
        this.fetchGitInfo();
        this.ensureFileInputAccessible();
    }

    ensureFileInputAccessible() {
      // Ensure the file input is properly accessible
      this.updateComplete.then(() => {
          const fileInput = this.shadowRoot.getElementById('aio-file-input');
          if (fileInput) {
              console.log('File input found and accessible');
              // Ensure it's not disabled
              fileInput.disabled = false;
              // Ensure it's properly configured
              fileInput.accept = '.json';
              fileInput.type = 'file';
          } else {
              console.warn('File input not found during initialization');
          }
      });
    }

    async fetchGitInfo() {
        try {
            const response = await fetch('/api/git-info');
            if (response.ok) {
                const data = await response.json();
                this.gitInfo = data;
                this.org = data.org;
                // Don't auto-set site, user will select it from dropdown
                console.log('Git info loaded:', this.gitInfo);
            } else {
                console.error('Failed to fetch git info');
                this.showToastNotification('Failed to load git repository information', 'negative');
            }
        } catch (error) {
            console.error('Error fetching git info:', error);
            this.showToastNotification('Error loading git repository information', 'negative');
        }
    }

    validateAccessToken(token) {
        try {
            // Parse the JWT token
            const [headerB64, payloadB64, signatureB64] = token.split('.');
            if (!headerB64 || !payloadB64 || !signatureB64) {
                throw new Error('Invalid token format');
            }

            const payload = JSON.parse(atob(payloadB64));
            const { exp, scope } = payload;

            // Check expiration
            if (Date.now() >= exp * 1000) {
                return { valid: false, error: 'Token has expired' };
            }

            return { valid: true, payload };
        } catch (error) {
            return { valid: false, error: 'Invalid token format: ' + error.message };
        }
    }

    handleAccessTokenChange(token) {
        this.accessToken = token;
        // Reset site selection when token changes
        this.site = '';
        this.availableSites = [];
        this.allowManualSiteEntry = false;
    }

    async fetchAvailableSites() {
        if (!this.accessToken || !this.org) {
            this.showToastNotification('Access token and organization are required', 'negative');
            return false;
        }

        this.loadingSites = true;
        try {
            const sitesEndpoint = `https://admin.hlx.page/config/${this.org}/sites.json`;
            console.log(`Fetching sites from ${sitesEndpoint}`);

            const response = await fetch(sitesEndpoint, {
                method: 'GET',
                headers: {
                    'authorization': `token ${this.accessToken}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();

                // If it's a 4xx error, allow manual site entry
                if (response.status >= 400 && response.status < 500) {
                    this.allowManualSiteEntry = true;
                    this.showToastNotification(`Unable to fetch sites (${response.status}). You can now enter the site name manually below.`, 'negative');
                    return false;
                } else {
                    this.showToastNotification(`Failed to fetch sites: ${response.status} ${response.statusText} - ${errorText}`, 'negative');
                    return false;
                }
            }

            const result = await response.json();
            this.availableSites = result.sites || [];

            if (this.availableSites.length === 0) {
                this.showToastNotification('No sites found for this organization', 'negative');
                return false;
            }


            // Auto-select first site if available and none selected yet
            if (!this.site && this.availableSites.length > 0) {
                const first = this.availableSites[0];
                if (first && first.name) {
                    this.site = first.name;
                    this.updateUrlsFromSelection();
                }
            }
            this.showToastNotification(`Found ${this.availableSites.length} sites`, 'positive');
            return true;

        } catch (error) {
            console.error('Error fetching sites:', error);
            this.showToastNotification('Error fetching sites: ' + error.message, 'negative');
            return false;
        } finally {
            this.loadingSites = false;
        }
    }

    async createApiKey() {
        if (!this.accessToken || !this.org || !this.site) {
            this.showToastNotification('Access token, organization, and site are required', 'negative');
            return false;
        }

        this.loading = true;
        try {
            const apiKeyEndpoint = `https://admin.hlx.page/config/${this.org}/sites/${this.site}/apiKeys.json`;
            const body = {
                description: `Key used by PDP Prerender components [${this.org}/${this.site}]`,
                roles: [
                    "preview",
                    "publish",
                    "config_admin"
                ]
            };

            console.log(`Creating API key at ${apiKeyEndpoint}`);

            const response = await fetch(apiKeyEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'authorization': `token ${this.accessToken}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.showToastNotification(`Failed to create API key: ${response.status} ${response.statusText} - ${errorText}`, 'negative');
                return false;
            }

            const result = await response.json();
            this.generatedApiKey = result;
            // Auto-populate the AEM admin token with the generated API key value
            this.token = result.value;
            // Set org/site for backward compatibility
            this.aioOrg = this.org;
            this.aioSite = this.site;
            // Auto-validate the token
            await this.handleTokenChange(this.token);
            this.showToastNotification('API key created successfully!', 'positive');
            return true;

        } catch (error) {
            console.error('Error creating API key:', error);
            this.showToastNotification('Error creating API key: ' + error.message, 'negative');
            return false;
        } finally {
            this.loading = false;
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();

        // Clean up toast timeout to prevent memory leaks
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
    }

    async verifyToken(token) {
        this.loading = true;
        this.error = '';
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const { sub, exp } = payload;

            if (Date.now() >= exp * 1000) {
                this.tokenValid = false;
                this.error = 'Token has expired.';
                this.showToastNotification('Token has expired.', 'negative');
                return;
            }

            const [org, site] = sub.split('/');

            if (org === '*' || site === '*') {
                this.tokenValid = false;
                this.error = 'Invalid token type.';
                this.showToastNotification('Only valid token types (API Keys) are accepted. See https://www.aem.live/docs/admin-apikeys#create to create one.', 'negative');
                return;
            }

            this.aioOrg = org;
            this.aioSite = site;
            this.tokenValid = true;
            this.aioConfigContent = JSON.stringify(payload, null, 2);

            // Check if token org/site matches user's configured values
            if (this.org && this.site && (org !== this.org || site !== this.site)) {
                this.showToastNotification(`Warning: Token is for ${org}/${site} but you configured ${this.org}/${this.site}. Make sure these match.`, 'negative');
            }
        } catch (e) {
            this.tokenValid = false;
            this.error = 'Invalid token format.';
            this.aioConfigContent = 'Invalid token format.';
            this.showToastNotification('Invalid token format.', 'negative');
        } finally {
            this.loading = false;
        }
    }

    async handleTokenChange(token) {
        this.token = token;
        if (token) {
            await this.verifyToken(token);
            if (this.tokenValid) {
                const baseUrl = `https://main--${this.site}--${this.org}.aem.live`;
                this.advancedSettings = {
                    ...this.advancedSettings,
                    contentUrl: baseUrl,
                    storeUrl: baseUrl,
                    productsTemplate: `${baseUrl}/products/default`
                };
            }
        } else {
            this.tokenValid = false;
            this.aioConfigContent = 'No token payload available';
        }
    }

    handleAdvancedSettingInput(field, value) {
        if (field === 'locales') {
            // Convert empty string to null for locales
            this.advancedSettings[field] = value.trim() === '' ? null : value;
        } else {
            this.advancedSettings[field] = value;
        }
        this.validateAdvancedSettings();
    }

    validateAdvancedSettings() {
        const { productPageUrlFormat, contentUrl, productsTemplate, storeUrl } = this.advancedSettings;

        if (!productPageUrlFormat) {
            this.showToastNotification('Product page URL format is required', 'negative');
            return false;
        }

        if (!contentUrl) {
            this.showToastNotification('Content URL is required', 'negative');
            return false;
        }

        if (!productsTemplate) {
            this.showToastNotification('Products template is required', 'negative');
            return false;
        }

        if (!storeUrl) {
            this.showToastNotification('Store URL is required', 'negative');
            return false;
        }

        // Validate URL format
        try {
            new URL(contentUrl);
            new URL(storeUrl);
        } catch (e) {
            this.showToastNotification('Invalid URL format for Content URL or Store URL', 'negative');
            return false;
        }

        return true;
    }

    async handleAIOConfigFileSelect(event) {
        const files = event.target.files;
        if (files && files.length > 0) {
            await this.processAIOConfigFile(files[0]);
        } else {
            console.warn('No files selected in file input');
        }
    }

    handleBrowseClick(event) {
        event.preventDefault();
        event.stopPropagation();

        console.log('Browse button clicked');

        // Create a temporary file input
        const tempInput = document.createElement('input');
        tempInput.type = 'file';
        tempInput.accept = '.json';
        tempInput.style.display = 'none';

        tempInput.addEventListener('change', (e) => {
            console.log('Temporary file input change event:', e);
            this.handleAIOConfigFileSelect(e);
            // Clean up the temporary input
            if (tempInput.parentNode) {
                tempInput.parentNode.removeChild(tempInput);
            }
        });

        document.body.appendChild(tempInput);
        tempInput.click();
    }

    async processAIOConfigFile(file) {
        this.processingAioConfig = true;

        try {
            const fileContent = await this.readFileAsText(file);
            const config = JSON.parse(fileContent);

            const {name: namespace, auth} = config.project?.workspace?.details?.runtime?.namespaces?.[0];

            console.log('Extracted namespace:', namespace);
            console.log('Extracted auth:', auth ? 'Found' : 'Not found');

            if (namespace && auth) {
                this.aioNamespace = namespace;
                this.aioAuth = auth;
                this.aioConfigFile = file;

                // Send the config to the backend
                const response = await fetch('/api/aio-config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        aioNamespace: namespace,
                        aioAuth: auth,
                        fileContent: fileContent,
                        fileName: file.name
                    })
                });

                const result = await response.json();

                if (result.success) {
                    this.showToastNotification(`AIO configuration loaded successfully! Namespace: ${namespace}`, 'positive');
                } else {
                    this.showToastNotification(`AIO configuration saved but failed to apply: ${result.error}`, 'negative');
                }
            } else {
                // Show more detailed error message
                const missingItems = [];
                if (!namespace) missingItems.push('namespace');
                if (!auth) missingItems.push('auth/client_secret');

                this.showToastNotification(`Could not extract ${missingItems.join(' and ')} from the configuration file. Please check the browser console for the file structure and ensure it's a valid AIO configuration file.`, 'negative');
                console.error('Failed to extract required fields. File structure:', config);
            }
        } catch (error) {
            console.error('Error processing AIO config file:', error);
            this.showToastNotification('Error processing AIO configuration file: ' + error.message, 'negative');
        } finally {
            this.processingAioConfig = false;
        }
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep -= 1;
        }
    }

    showToastNotification(message, variant = 'negative') {
        // Clear any existing timeout
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }

        this.toastMessage = message;
        this.toastVariant = variant;
        this.showToast = true;

        // Auto-hide after 4 seconds (positive toasts) or 6 seconds (negative toasts)
        const autoHideDelay = variant === 'positive' ? 4000 : 6000;
        this.toastTimeout = setTimeout(() => {
            this.hideToastNotification();
        }, autoHideDelay);
    }

    hideToastNotification() {
        // Clear the timeout when manually hiding
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
        this.showToast = false;
    }

    maskCredential(credential) {
        if (!credential || credential.length <= 10) {
            return credential || 'Not loaded';
        }
        const start = credential.substring(0, 6);
        const end = credential.substring(credential.length - 4);
        const middle = '*'.repeat(Math.min(12, credential.length - 10));
        return `${start}${middle}${end}`;
    }

    handleToastClose(event) {
        event.stopPropagation();
        this.hideToastNotification();
    }

    handleToastClick(event) {
        event.stopPropagation();
        this.hideToastNotification();
    }

    async nextStep() {
        if (this.currentStep === 1) {
            if (!this.accessToken) {
                this.showToastNotification('Please enter an access token', 'negative');
                return;
            }
            if (!this.org) {
                this.showToastNotification('Please enter organization name', 'negative');
                return;
            }
            this.site = (this.site || '').trim();
            if (!this.site) {
                this.showToastNotification('Please select a site (dropdown) or enter it manually below.', 'negative');
                return;
            }

            // Validate the access token
            const tokenValidation = this.validateAccessToken(this.accessToken);
            if (!tokenValidation.valid) {
                this.showToastNotification(`Token validation failed: ${tokenValidation.error}`, 'negative');
                return;
            }

            const success = await this.createApiKey();
            if (!success) {
                return;
            }
        } else if (this.currentStep === 2) {
            // No additional validation needed for step 2 - just proceed
            // The generated API key from step 1 will be used
        } else if (this.currentStep === 3) {
            if (!this.validateAdvancedSettings()) {
                return;
            }
            await this.handlePreviewSetup();
        } else if (this.currentStep === 4) {
            await this.applyConfig();
            await this.performHealthChecks();
            // After health checks complete, submit to external endpoint
            await this.submitToExternalEndpoint();
            return; // Don't increment step, we're done
        }
        this.currentStep++;
    }

    async handlePreviewSetup() {
        this.loading = true;

        const diffViewer = this.shadowRoot.querySelector('diff-viewer');
        if (diffViewer) diffViewer.loading = true;

        try {
            const response = await fetch(`/api/setup?org=${encodeURIComponent(this.org)}&site=${encodeURIComponent(this.site)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AIO-auth': this.aioAuth,
                    'X-AIO-namespace': this.aioNamespace,
                    'X-AEM-admin-token': this.accessToken
                },
                body: JSON.stringify({
                    contentUrl: this.advancedSettings.contentUrl,
                    productsTemplate: this.advancedSettings.productsTemplate,
                    productPageUrlFormat: this.advancedSettings.productPageUrlFormat,
                    storeUrl: this.advancedSettings.storeUrl,
                    locales: this.advancedSettings.locales
                })
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const data = await response.json();
            this.previewData = data;
            this.configPatch = data.patch;

        } catch (error) {
            this.showToastNotification('Failed to generate config preview.', 'negative');
        } finally {
            this.loading = false;
            if (diffViewer) diffViewer.loading = false;
        }
    }

    downloadConfig() {
        if (this.previewData && this.previewData.newAppConfig) {
            const a = document.createElement('a');
            const file = new Blob([this.previewData.newAppConfig], {type: 'text/yaml'});
            a.href = URL.createObjectURL(file);
            a.download = 'app.config.yaml';
            a.click();
            URL.revokeObjectURL(a.href);
        }
    }

    downloadConfigFiles() {
        // Download app.config.yaml
        this.downloadConfig();

        // Download aem-commerce-prerender-org--site.json
        const commerceConfig = {
            aemAdminToken: this.accessToken,
            org: this.org,
            site: this.site,
            aioAuth: this.aioAuth,
            aioNamespace: this.aioNamespace
        };

        const fileName = `aem-commerce-prerender-${this.org}--${this.site}.json`;
        const jsonContent = JSON.stringify(commerceConfig, null, 2);

        const a = document.createElement('a');
        const file = new Blob([jsonContent], {type: 'application/json'});
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);

        this.showToastNotification('Configuration files downloaded successfully!', 'positive');
    }

    async applyConfig() {
        this.loading = true;
        try {
            const response = await fetch(`/api/helix-config?org=${encodeURIComponent(this.org)}&site=${encodeURIComponent(this.site)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AEM-admin-token': this.accessToken
                },
                body: JSON.stringify({
                    newIndexConfig: this.previewData.newIndexConfig,
                    newSiteConfig: this.previewData.newSiteConfig,
                    appConfigParams: {
                        org: this.org,
                        site: this.site,
                        ...this.advancedSettings
                    },
                    aioNamespace: this.aioNamespace,
                    aioAuth: this.aioAuth,
                    serviceToken: this.token
                })
            });

            if (!response.ok) throw new Error('Failed to apply config');
            this.showToastNotification('Configuration applied successfully and app.config.yaml written to local filesystem!', 'positive');
            return true;
        } catch (error) {
            this.showToastNotification('Error applying configuration.', 'negative');
            return false;
        } finally {
            this.loading = false;
        }
    }

    async performHealthChecks() {
        this.loading = true;
        this.healthChecks = [];
        // Health check for rules endpoint
        try {
            const rulesUrl = `${window.location.origin}/api/rules`;
            const rulesResponse = await fetch(rulesUrl, {
                headers: {
                    'x-aio-auth': this.aioAuth,
                    'x-aio-namespace': this.aioNamespace
                }
            });

            // We expect a 2xx status code for success
            this.healthChecks.push({
                name: 'Rules Endpoint',
                status: rulesResponse.status >= 200 && rulesResponse.status < 300,
                message: rulesResponse.status >= 200 && rulesResponse.status < 300 ? 'Rules endpoint accessible' : 'Rules endpoint not accessible'
            });
        } catch (error) {
            this.healthChecks.push({
                name: 'Rules Endpoint',
                status: false,
                message: 'Failed to check rules endpoint'
            });
        }

        this.loading = false;
        const allChecksPassed = this.healthChecks.every(check => check.status);
        if (allChecksPassed) {
            this.showToastNotification('All health checks passed!', 'positive');
        } else {
            this.showToastNotification('Some health checks failed. Please review and click Done to complete setup.', 'negative');
        }
    }

    async submitToExternalEndpoint() {
        try {
            // Prepare the JSON payload
            const payload = {
                id: `${this.org}/${this.site}`,
                org: this.org,
                site: this.site,
                appbuilderProjectJSON: {
                    project: {
                        name: this.aioConfigFile?.name?.replace('.json', '') || 'aem-commerce-prerender',
                        title: `AEM Commerce Prerender - ${this.org}/${this.site}`,
                        id: `${this.org}-${this.site}-commerce-prerender`,
                        workspace: {
                            details: {
                                runtime: {
                                    namespaces: [
                                        {
                                            name: this.aioNamespace,
                                            auth: this.aioAuth
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                aemAdminJWT: this.generatedApiKey,
                annotations: []
            };

            // Create and submit form
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = 'https://prerender.aem-storefront.com/setup-done';
            form.style.display = 'none';

            // Add the JSON payload as a form field
            const dataInput = document.createElement('input');
            dataInput.type = 'hidden';
            dataInput.name = 'data';
            dataInput.value = JSON.stringify(payload);
            form.appendChild(dataInput);

            // Append form to document and submit
            document.body.appendChild(form);

            console.log('Submitting configuration to external endpoint...');
            console.log('Payload:', JSON.stringify(payload, null, 2));

            this.showToastNotification('Setup complete! Redirecting to external configuration...', 'positive');

            // Submit the form - this will redirect to the target page
            setTimeout(() => {
                form.submit();
            }, 1500); // Give user time to see the success message

        } catch (error) {
            console.error('Error submitting to external endpoint:', error);
            this.showToastNotification('Setup completed but failed to submit to external endpoint: ' + error.message, 'negative');
        }
    }

    renderWizardStep() {
        switch (this.currentStep) {
            case 1:
                return this.renderStep1AccessToken();
            case 2:
                return this.renderStep2Token();
            case 3:
                return this.renderStep3AdvancedSettings();
            case 4:
                return this.renderStep4Review();
            default:
                return html`<div>Invalid step</div>`;
        }
    }

    renderStep1AccessToken() {
        return html`<div class="step-content">
            <h3>Step 1: Get Access Token</h3>

            <div class="full-width-section">
                <div class="centered-content">
                    <div style="max-width: 600px; text-align: center;">
                        <p style="margin-bottom: 24px; color: #ccc; line-height: 1.5;">
                            Before we can proceed with the setup, you need to login to the AEM Admin API and retrieve an access token (this will later be used to retrieve a permanent service token for the Prerendering service).
                        </p>

                        ${this.gitInfo ? html`
                            <div style="margin-bottom: 24px; padding: 16px; background-color: #1a1a1a; border-radius: 6px; border: 1px solid #333;">
                                <div style="margin-bottom: 8px;">
                                    <sp-field-label for="org-input">Organization</sp-field-label>
                                    <sp-textfield
                                        id="org-input"
                                        .value=${this.org}
                                        @input=${e => this.handleOrgChange(e)}
                                        style="width: 100%;"
                                    ></sp-textfield>
                                </div>
                                <p style="margin: 0; color: #7d8590; font-size: 12px; text-align: left;">
                                    Organization auto-detected from git repository. You can edit it if needed.
                                </p>
                            </div>
                        ` : ''}

                        <div style="text-align: left; background-color: #1a1a1a; padding: 20px; border-radius: 6px; border: 1px solid #333; margin-bottom: 24px;">
                            <h4 style="margin: 0 0 12px 0;">Instructions:</h4>
                            <ol style="margin: 0; padding-left: 20px; color: #ccc; line-height: 1.6;">
                                <li><a href="https://admin.hlx.page/login" target="_blank">Login</a> to the AEM Admin API (select the link from your preferred Identity Provider: the ones suffixed by "_sa" allow to select a specific account rather than the one currently logged in)</li>
                                <li>Once redirected to the JSON response, open your browser's Developer Tools (F12)</li>
                                <li>Go to the Application tab (Chrome) or Storage tab (Firefox)</li>
                                <li>Under Cookies, find and copy the value of the <strong>auth_token</strong> cookie</li>
                                <li>Paste that token in the textarea below</li>
                            </ol>
                        </div>

                        <div class="token-field-container" style="margin-bottom: 24px;">
                            <sp-field-label for="access-token" required>Access Token</sp-field-label>
                            <sp-textfield
                                id="access-token"
                                multiline
                                rows="4"
                                placeholder="Paste your auth_token cookie value here..."
                                .value=${this.accessToken}
                                @input=${e => this.handleAccessTokenChange(e.target.value)}
                                style="width: 100%; font-family: monospace; font-size: 12px;"
                            ></sp-textfield>
                        </div>

                        ${this.accessToken ? html`
                            <div style="margin-bottom: 24px;">
                                <sp-button
                                    variant="secondary"
                                    @click=${this.fetchAvailableSites}
                                    ?disabled=${this.loadingSites}
                                    style="margin-bottom: 16px;"
                                >
                                    ${this.loadingSites ? html`<sp-progress-circle indeterminate size="s"></sp-progress-circle> Loading Sites...` : 'Load Available Sites'}
                                </sp-button>
                            </div>
                        ` : ''}

                        ${this.availableSites.length > 0 ? html`
                            <div class="token-field-container">
                                <sp-field-label for="site-select" required>Select Site</sp-field-label>
                                <sp-picker
                                        id="site-select"
                                        .value=${this.site}
                                        @change=${e => this.handleSiteChange(e)}
                                        style="width: 100%;"
                                >
                                    <sp-menu-item value="">Select a site...</sp-menu-item>
                                    ${this.availableSites.map(site => html`
                                        <sp-menu-item value="${site.name}">${site.name}</sp-menu-item>
                                    `)}
                                </sp-picker>
                            </div>
                        ` : this.allowManualSiteEntry ? html`
                            <div class="token-field-container">
                                <sp-field-label for="site-manual" required>Site Name</sp-field-label>
                                <sp-textfield
                                    id="site-manual"
                                    placeholder="Enter site name manually..."
                                    .value=${this.site}
                                    @input=${e => this.handleSiteChange(e)}
                                    style="width: 100%;"
                                ></sp-textfield>
                                <p style="margin: 8px 0 0 0; color: #7d8590; font-size: 12px;">
                                    Unable to load sites automatically. Please enter the site name manually.
                                </p>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderStep2Token() {
        return html`<div class="step-content">
            <h3>Step 2: AIO Configuration</h3>

            <!-- Generated API Key Display -->
            <div class="full-width-section">
                <div class="centered-content">
                    ${this.generatedApiKey ? html`
                        <div style="margin-bottom: 24px; padding: 16px; background-color: #1a1a1a; border-radius: 6px; border: 1px solid #333;">
                            <h4 style="margin: 0 0 12px 0;">Generated API Key</h4>
                            <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-family: monospace; font-size: 12px; margin-bottom: 12px;">
                                <span style="color: #7d8590;">ID:</span>
                                <span style="color: #f0f6fc;">${this.generatedApiKey.id}</span>
                                <span style="color: #7d8590;">Description:</span>
                                <span style="color: #f0f6fc;">${this.generatedApiKey.description}</span>
                                <span style="color: #7d8590;">Expires:</span>
                                <span style="color: #f0f6fc;">${new Date(this.generatedApiKey.expiration).toLocaleString()}</span>
                            </div>
                            <p style="margin: 0; color: #7d8590; font-size: 12px;">
                                This API key will be used for the prerender service configuration.
                            </p>
                        </div>
                    ` : html`
                        <div style="margin-bottom: 24px; padding: 16px; background-color: #1a1a1a; border-radius: 6px; border: 1px solid #333;">
                            <p style="margin: 0; color: #f0f6fc; text-align: center;">
                                No API key generated yet. Please complete Step 1 first.
                            </p>
                        </div>
                    `}
                </div>
            </div>

            <!-- AIO Configuration Upload Section - Full Width Row -->
            <div class="full-width-section">
                <div class="centered-content">
                    <div class="dropzone-section">
                        ${this.processingAioConfig ? html`
                            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; gap: 16px;">
                                <sp-progress-circle indeterminate size="l" label="Processing configuration..."></sp-progress-circle>
                                <span style="color: #f0f6fc; font-size: 14px;">Processing AIO configuration file...</span>
                            </div>
                        ` : html`
                            <div style="display: flex; justify-content: center; width: 100%;">
                                <div class="file-upload-container" style="width: 100%; max-width: 500px; border: 2px solid #333; border-radius: 8px; padding: 40px; text-align: center; background-color: #2a2a2a;">
                                    <div class="upload-content">
                                        <sp-icon-upload style="font-size: 48px; color: #0078d4; margin-bottom: 16px;"></sp-icon-upload>
                                        <h4 style="margin: 0 0 8px 0; color: #f0f6fc;">Upload the AIO configuration JSON from your App Builder project</h4>
                                        <p style="margin: 0 0 24px 0; color: #999;">Select your AIO configuration file to automatically load namespace and auth credentials.</p>
                                        <button type="button" class="browse-button" @click=${this.handleBrowseClick}>
                                            Browse Files
                                        </button>
                                        <input type="file" accept=".json" @change=${this.handleAIOConfigFileSelect} style="display: none;" id="aio-file-input" />
                                    </div>
                                </div>
                            </div>
                        `}
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderStep3AdvancedSettings() {
        return html`
            <div class="step-content">
                <h3>Step 3: Review Configuration</h3>

                <!-- AIO Credentials Display -->
                <div style="margin-bottom: 24px; padding: 16px; background-color: #1a1a1a; border-radius: 6px; border: 1px solid #333;">
                    <h4 style="margin: 0 0 12px 0; color: #f0f6fc;">AIO Runtime Credentials</h4>
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-family: monospace; font-size: 12px;">
                        <span style="color: #7d8590;">Namespace:</span>
                        <span style="color: #f0f6fc;">${this.aioNamespace || 'Not loaded'}</span>
                        <span style="color: #7d8590;">Auth:</span>
                        <span style="color: #f0f6fc;">${this.maskCredential(this.aioAuth)}</span>
                    </div>
                </div>

                <!-- Main Configuration Fields -->
                <div class="main-config-fields">
                    <div class="form-grid">
                        <sp-field-label for="org-field">Organization</sp-field-label>
                        <sp-textfield
                            id="org-field"
                            .value=${this.org}
                            readonly
                            style="background-color: #2a2a2a;"
                        ></sp-textfield>

                        <sp-field-label for="site-field">Site</sp-field-label>
                        <sp-textfield
                            id="site-field"
                            .value=${this.site}
                            readonly
                            style="background-color: #2a2a2a;"
                        ></sp-textfield>

                        <sp-field-label for="product-page-url-format" required>Product Page URL Format</sp-field-label>
                        <sp-textfield
                            id="product-page-url-format"
                            .value=${this.advancedSettings.productPageUrlFormat}
                            @input=${e => this.handleAdvancedSettingInput('productPageUrlFormat', e.target.value)}
                        ></sp-textfield>

                        <sp-field-label for="locales">Locales (can be empty)</sp-field-label>
                        <sp-textfield
                            id="locales"
                            .value=${this.advancedSettings.locales || ''}
                            @input=${e => this.handleAdvancedSettingInput('locales', e.target.value)}
                        ></sp-textfield>
                    </div>
                </div>

                <!-- Advanced Settings Accordion -->
                <div style="margin-top: 24px;">
                    <sp-accordion allow-multiple>
                        <sp-accordion-item label="Advanced Settings" ?open=${false}>
                            <div class="form-grid" style="padding: 16px 0;">
                                <sp-field-label for="content-url" required>Content URL</sp-field-label>
                                <sp-textfield
                                    id="content-url"
                                    .value=${this.advancedSettings.contentUrl}
                                    @input=${e => this.handleAdvancedSettingInput('contentUrl', e.target.value)}
                                ></sp-textfield>

                                <sp-field-label for="products-template" required>Products Template</sp-field-label>
                                <sp-textfield
                                    id="products-template"
                                    .value=${this.advancedSettings.productsTemplate}
                                    @input=${e => this.handleAdvancedSettingInput('productsTemplate', e.target.value)}
                                ></sp-textfield>

                                <sp-field-label for="store-url" required>Commerce Store URL</sp-field-label>
                                <sp-textfield
                                    id="store-url"
                                    .value=${this.advancedSettings.storeUrl}
                                    @input=${e => this.handleAdvancedSettingInput('storeUrl', e.target.value)}
                                ></sp-textfield>
                            </div>
                        </sp-accordion-item>
                    </sp-accordion>
                </div>
            </div>`;
    }

    renderStep4Review() {
        return html`
            <div class="step-content">
                <h3>Step 4: Preview & Apply Configuration</h3>
                <p>Below is a preview of the configuration changes that will be applied.</p>
                <diff-viewer .patch=${this.configPatch} ?loading=${this.loading}></diff-viewer>
                ${this.loading ? html`
                    <div style="display: flex; align-items: center; justify-content: center; margin-top: 20px; gap: 12px;">
                        <sp-progress-circle indeterminate label="Applying configuration and running health checks..."></sp-progress-circle>
                        <span>Applying configuration and running health checks...</span>
                    </div>
                ` : ''}
                ${this.healthChecks.length > 0 ? html`
                    <div class="health-check-container" style="margin-top: 20px;">
                        <h4>Health Check Results</h4>
                        ${this.healthChecks.map(check => html`
                            <div class="health-check-item">
                                <span>${check.name}</span>
                                <sp-status-light variant=${check.status ? 'positive' : 'negative'}>${check.status ? 'OK' : 'FAIL'}</sp-status-light>
                            </div>
                        `)}
                        ${!this.healthChecks.every(check => check.status) ? html`
                            <sp-button @click=${this.performHealthChecks}>Retry Health Checks</sp-button>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }

    render() {
        return html`
            ${this.showToast ? html`
                <div
                    class="toast-notification ${this.showToast ? 'visible' : ''}"
                    style="background-color: ${this.toastVariant === 'positive' ? 'var(--toast-positive-bg)' : 'var(--toast-negative-bg)'};"
                    @click=${this.handleToastClick}
                >
                    <div class="toast-content">
                        <span>${this.toastMessage}</span>
                        <button class="toast-close" @click=${this.handleToastClose}>×</button>
                    </div>
                </div>
            ` : ''}
            <div class="container">
                <div class="title">AEM Commerce Prerender Setup</div>
                <div class="wizard-container">
                    <div class="step-indicator">
                        ${[1, 2, 3, 4].map(i => html`
                            <div class="step ${this.currentStep === i ? 'active' : ''}">${i}</div>
                            ${i < 4 ? html`<div class="step-connector"></div>` : ''}
                        `)}
                    </div>
                    <div class="wizard-content">
                        ${this.renderWizardStep()}
                    </div>
                    <div class="button-group">
                        <sp-button variant="secondary" @click=${this.prevStep} ?disabled=${this.currentStep === 1}>Back</sp-button>
                        ${this.currentStep < 4 ? html`
                            <sp-button variant="primary" @click=${this.nextStep} ?disabled=${this.loading}>
                                ${this.loading ? html`<sp-progress-circle indeterminate size="s"></sp-progress-circle> Loading...` : 'Next'}
                            </sp-button>
                        ` : html`
                            <sp-button variant="primary" @click=${this.nextStep} ?disabled=${this.loading}>
                                ${this.loading ? html`<sp-progress-circle indeterminate size="s"></sp-progress-circle> Processing...` : 'Complete Setup'}
                            </sp-button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }
}

if (!customElements.get('setup-wizard')) {
    customElements.define('setup-wizard', SetupWizard);
}
