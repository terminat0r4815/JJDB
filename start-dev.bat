@echo off
echo Starting MTG AI Builder in development mode...

:: Kill any existing node processes on port 3000
echo Checking for existing server processes...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    echo Found existing process on port 3000 ^(PID: %%a^)
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 (
        echo Stopped existing server process
    )
)

:: Check Node.js installation
where node >nul 2>&1
if errorlevel 1 (
    echo [31mError: Node.js is not installed[0m
    echo Please install Node.js from https://nodejs.org
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: Check npm installation
where npm >nul 2>&1
if errorlevel 1 (
    echo [31mError: npm is not installed[0m
    echo Please install Node.js from https://nodejs.org
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: Check for .env and create if needed
if not exist ".env" (
    echo Creating .env file...
    (
        echo OPENAI_API_KEY=your_api_key_here
        echo OPENAI_ORGANIZATION_ID=
        echo PORT=3000
        echo NODE_ENV=development
    ) > .env
    echo Created .env file. Please edit it with your OpenAI API key.
    notepad .env
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [31mError: Failed to install dependencies[0m
        echo Please check your internet connection and try again.
        echo.
        echo Press any key to exit...
        pause >nul
        exit /b 1
    )
)

:: Start the server
echo Starting development server...
call npm run dev

echo.
echo Development server stopped.
echo.
echo Press any key to exit...
pause >nul 