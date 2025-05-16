@echo off
echo Updating Git Repository...
echo.

echo Adding all changes...
git add .

echo.
echo Enter your commit message:
set /p commit_msg="> "

echo.
echo Committing changes...
git commit -m "%commit_msg%"

echo.
echo Pushing to remote repository...
git push origin master

echo.
echo Done!
pause 