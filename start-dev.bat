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

:: Check for script.js
if not exist "script.js" (
    echo [31mError: script.js not found in current directory[0m
    echo Current directory: %CD%
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

:: Backup script.js
echo Creating backup of script.js...
copy "script.js" "script.js.bak" >nul
if errorlevel 1 (
    echo [31mError: Could not create backup of script.js[0m
    echo Please make sure you have write permissions in this directory.
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: Update BACKEND_URL in script.js
echo Updating backend URL to development mode...
powershell -Command "(Get-Content script.js) -replace 'const BACKEND_URL = .*', 'const BACKEND_URL = ''http://localhost:3000'';  // Development URL' | Set-Content script.js"
if errorlevel 1 (
    echo [31mError: Could not update script.js[0m
    echo Please make sure you have write permissions and PowerShell is available.
    echo.
    echo Press any key to exit...
    pause >nul
    copy "script.js.bak" "script.js" >nul
    del "script.js.bak" >nul
    exit /b 1
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

:: If server exits, restore production URL
echo.
echo [36mRestoring production configuration...[0m
copy "script.js.bak" "script.js" >nul
del "script.js.bak" >nul
echo [32mRestored to production mode[0m
echo.
echo Press any key to exit...
pause >nul 