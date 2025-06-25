import { LitElement, html, css } from 'lit';
import './setup-wizard.js';

export class AppMain extends LitElement {
    static styles = css`
        :host {
            display: block;
            background-color: #1a1a1a;
            color: #ffffff;
            margin: 0;
            padding: 20px;
        }

        sp-theme {
            display: block;
            width: 100%;
            height: 100%;
        }
    `;

    render() {
        return html`
            <sp-theme theme="spectrum" color="dark" scale="medium">
                <setup-wizard></setup-wizard>
            </sp-theme>
        `;
    }
}

if (!customElements.get('app-main')) {
    customElements.define('app-main', AppMain);
} 