import { render } from 'solid-js/web';
import { applyTheme } from '../../src/platform/applyTheme';

import App from './App';
import './App.css';

applyTheme();
render(() => <App />, document.getElementById('root')!);
