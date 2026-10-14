import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '@veydeck/tokens/index.css'
import '@veydeck/vue/style.css'
import './styles/global.css'

const app = createApp(App)

app.use(router)

app.mount('#app')
