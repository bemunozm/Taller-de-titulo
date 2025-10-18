# Publish a test stream to local rtsp-simple-server using ffmpeg
param(
  [string]$Url = 'rtsp://localhost:8556/mystream'
)

Write-Host "Publishing to $Url using ffmpeg (press Ctrl+C to stop)"
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i anullsrc -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f rtsp $Url