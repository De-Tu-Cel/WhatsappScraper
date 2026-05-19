import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import ThemeRegistry from '../components/ThemeRegistry'

export const metadata = {
  title: 'Lector Comercial',
  description: 'Herramienta de prospección y análisis de empresas',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <ThemeRegistry>
          {children}
        </ThemeRegistry>
      </body>
    </html>
  )
}