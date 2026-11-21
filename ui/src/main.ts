import { createApp } from 'vue'
import './themes'
import './styles/app.css'
import App from './App.vue'
import { createAppRouter } from './router'

createApp(App).use(createAppRouter()).mount('#app')
