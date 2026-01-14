# jira-to-linear

CLI interactivo para migrar historias y subtareas de Jira a Linear.

## Uso

```bash
npx @javierlopezr/jira-to-linear
```

O instalar globalmente:

```bash
npm install -g @javierlopezr/jira-to-linear
jira-to-linear
```

## Características

- Autenticación OAuth (sin necesidad de crear API tokens manualmente)
- Migra historias (Stories) y sus subtareas como sub-issues en Linear
- Convierte descripciones de formato Jira (ADF) a Markdown
- Permite crear proyectos nuevos en Linear o usar existentes
- Filtra historias por texto en tiempo real
- Guarda credenciales localmente para no pedirlas cada vez
- ESC para salir de cualquier menú

## Autenticación

La primera vez que ejecutes la herramienta:

1. Se abrirá el navegador para **autorizar Jira**
2. Se abrirá el navegador para **autorizar Linear**
3. Las credenciales se guardan en `~/.jira-to-linear.json`

Para resetear credenciales:

```bash
jira-to-linear --reset
```

## Flujo de migración

1. Selecciona el proyecto de Jira
2. Filtra por historias no finalizadas (opcional)
3. Escribe para filtrar y selecciona las historias a migrar
4. Selecciona el equipo de Linear
5. Crea un proyecto nuevo o selecciona uno existente
6. La herramienta migra las historias y sus subtareas
7. Continúa migrando más o cambia de proyecto

## Qué se migra

- Título de la historia/subtarea
- Descripción (convertida a Markdown)
- Relación padre-hijo (subtareas como sub-issues)
- Enlace de referencia al issue original de Jira

## Controles

- **↑↓** - Navegar
- **Espacio** - Marcar/desmarcar (en checkbox)
- **Enter** - Confirmar
- **ESC** - Salir

## Requisitos

- Node.js >= 18.0.0

## Licencia

MIT
