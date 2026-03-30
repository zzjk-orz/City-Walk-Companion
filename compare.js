<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文本对比工具</title>
    <style>
        body { font-family: sans-serif; padding: 20px; background: #f4f4f9; }
        .container { display: flex; gap: 20px; }
        textarea { width: 100%; height: 200px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
        #result { margin-top: 20px; padding: 15px; background: white; border: 1px solid #ddd; border-radius: 4px; min-height: 50px; white-space: pre-wrap; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .diff { background-color: #ffcccc; text-decoration: line-through; }
        .match { background-color: #ccffcc; }
    </style>
</head>
<body>

    <h2>简易文本对比器</h2>
    <div class="container">
        <textarea id="text1" placeholder="在此输入原文..."></textarea>
        <textarea id="text2" placeholder="在此输入对比文..."></textarea>
    </div>
    <br>
    <button onclick="compareText()">开始对比</button>

    <h3>对比结果：</h3>
    <div id="result">结果将显示在这里...</div>

    <script>
        function compareText() {
            const t1 = document.getElementById('text1').value;
            const t2 = document.getElementById('text2').value;
            const resultDiv = document.getElementById('result');

            if (t1 === t2) {
                resultDiv.innerHTML = "<b style='color:green;'>内容完全一致！</b>";
            } else {
                resultDiv.innerHTML = "<b style='color:red;'>内容存在差异。</b><br>建议使用专业工具查看具体行差。";
            }
        }
    </script>
</body>
</html>