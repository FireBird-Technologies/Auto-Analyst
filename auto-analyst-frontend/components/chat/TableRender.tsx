import React from "react"

// Helper function to process table markers in error content (similar to processTableMarkersInOutput but with red styling)
const processTableMarkersInErrorOutput = (content: string) => {
  const tableRegex = /<TABLE_START>\n?([\s\S]*?)\n?<TABLE_END>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let partIndex = 0;
  
  // Process all table markers
  while ((match = tableRegex.exec(content)) !== null) {
    // Add content before the table if any
    if (match.index > lastIndex) {
      const beforeContent = content.substring(lastIndex, match.index);
      if (beforeContent.trim()) {
        parts.push(
          <pre key={`before-${partIndex}`} className="text-xs text-red-700 font-mono whitespace-pre-wrap">
            {beforeContent}
          </pre>
        );
      }
    }
    
    // Process the table content
    const tableContent = match[1];
    
    // Simple table parser for errors - use Dataset Preview styling
    const parseErrorTableContent = (content: string) => {
      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length === 0) return null;
      
      const rows: string[][] = [];
      for (const line of lines) {
        if (line.includes('|')) {
          const columns = line.split('|').map(col => col.trim()).filter(Boolean);
          if (columns.length > 0) {
            rows.push(columns);
          }
        } else {
          const columns = line.trim().split(/\s{2,}/).filter(col => col.trim());
          if (columns.length > 0) {
            rows.push(columns);
          }
        }
      }
      
      if (rows.length === 0) return null;
      
      const maxCols = Math.max(...rows.map(row => row.length));
      const normalizedRows = rows.map(row => {
        while (row.length < maxCols) {
          row.push('');
        }
        return row;
      });
      
      return (
        <div key={`error-table-${partIndex}`} className="my-4 border rounded-md overflow-hidden flex flex-col">
          <div className="bg-red-50 px-3 py-2 text-xs font-medium text-red-600 border-b flex-shrink-0">
            {normalizedRows.length} rows, {maxCols} columns
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs min-w-max">
              <thead className="sticky top-0 bg-red-100">
                <tr>
                  {normalizedRows[0]?.map((header: string, index: number) => (
                    <th key={index} className="px-2 py-1 text-left font-medium text-red-700 border-r whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {normalizedRows.slice(1).map((row: string[], rowIndex: number) => (
                  <tr key={rowIndex} className="border-b hover:bg-red-50">
                    {row.map((cell: string, cellIndex: number) => (
                      <td key={cellIndex} className="px-2 py-1 border-r text-red-600 whitespace-nowrap">
                        {cell !== null && cell !== undefined ? String(cell) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    };
    
    const tableElement = parseErrorTableContent(tableContent);
    if (tableElement) {
      parts.push(tableElement);
    }
    
    lastIndex = match.index + match[0].length;
    partIndex++;
  }
  
  // Add remaining content after the last table
  if (lastIndex < content.length) {
    const remainingContent = content.substring(lastIndex);
    if (remainingContent.trim()) {
      parts.push(
        <pre key={`after-${partIndex}`} className="text-xs text-red-700 font-mono whitespace-pre-wrap">
          {remainingContent}
        </pre>
      );
    }
  }
  
  // If no tables were found, return the original content as pre
  if (parts.length === 0) {
    return (
      <pre className="text-xs text-red-700 font-mono whitespace-pre-wrap overflow-auto max-h-[400px]">
        {content}
      </pre>
    );
  }
  
  return <div>{parts}</div>;
};

const processTableMarkersInOutput = (content: string) => {
  const tableRegex = /<TABLE_START>\n?([\s\S]*?)\n?<TABLE_END>/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let partIndex = 0;
  
  // Process all table markers
  while ((match = tableRegex.exec(content)) !== null) {
    // Add content before the table if any
    if (match.index > lastIndex) {
      const beforeContent = content.substring(lastIndex, match.index);
      if (beforeContent.trim()) {
        parts.push(
          <pre key={`before-${partIndex}`} className="text-xs text-gray-800 font-mono whitespace-pre-wrap">
            {beforeContent}
          </pre>
        );
      }
    }
    
    // Process the table content
    const tableContent = match[1];
    
    const parseTableContent = (content: string) => {
      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length === 0) return null;
      
      const parseGenericTable = (tableLines: string[]) => {
        const rows: string[][] = [];
        
        for (const line of tableLines) {
          if (line.includes('|')) {
            // Markdown table format
            const columns = line.split('|').map(col => col.trim()).filter(Boolean);
            if (columns.length > 0) {
              rows.push(columns);
            }
          } else {
            // Space-separated format
            const columns = line.trim().split(/\s{2,}/).filter(col => col.trim());
            if (columns.length > 0) {
              rows.push(columns);
            }
          }
        }
        
        if (rows.length === 0) return null;
        
        const maxCols = Math.max(...rows.map(row => row.length));
        const normalizedRows = rows.map(row => {
          while (row.length < maxCols) {
            row.push('');
          }
          return row;
        });
        
        // Detect header row
        let hasHeaderRow = false;
        let headerRowIndex = 0;
        
        if (normalizedRows.length > 1) {
          const firstRow = normalizedRows[0];
          const textCellCount = firstRow.filter(cell => isNaN(Number(cell))).length;
          
          // If first row has mostly text, it's likely a header
          if (textCellCount > maxCols / 2) {
            hasHeaderRow = true;
            headerRowIndex = 0;
          }
        }
        
        return {
          rows: normalizedRows,
          hasHeaderRow,
          headerRowIndex,
          maxCols
        };
      };
      
      const tableInfo = parseGenericTable(lines);
      if (!tableInfo) return null;
      
      const { rows, hasHeaderRow, maxCols } = tableInfo;
      const { headerRowIndex } = tableInfo;
      
      return (
        <div key={`table-${partIndex}`} className="my-4 border rounded-md overflow-hidden flex flex-col">
          <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 border-b flex-shrink-0">
            {rows.length} rows, {maxCols} columns
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs min-w-max">
              <thead className="sticky top-0 bg-gray-100">
                <tr>
                  {rows[0]?.map((header: string, index: number) => (
                    <th key={index} className="px-2 py-1 text-left font-medium text-gray-700 border-r whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(hasHeaderRow ? 1 : 0).map((row: string[], rowIndex: number) => (
                  <tr key={rowIndex} className="border-b hover:bg-gray-50">
                    {row.map((cell: string, cellIndex: number) => {
                      const isNumber = !isNaN(Number(cell.replace(/,/g, ''))) && cell !== '' && !hasHeaderRow;
                      
                      return (
                        <td 
                          key={cellIndex} 
                          className={`px-2 py-1 border-r text-gray-600 whitespace-nowrap ${
                            isNumber ? 'text-right font-mono' : ''
                          }`}
                        >
                          {cell !== null && cell !== undefined ? String(cell) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    };
    
    const tableElement = parseTableContent(tableContent);
    if (tableElement) {
      parts.push(tableElement);
    }
    
    lastIndex = match.index + match[0].length;
    partIndex++;
  }
  
  // Add remaining content after the last table
  if (lastIndex < content.length) {
    const remainingContent = content.substring(lastIndex);
    if (remainingContent.trim()) {
      parts.push(
        <pre key={`after-${partIndex}`} className="text-xs text-gray-800 font-mono whitespace-pre-wrap">
          {remainingContent}
        </pre>
      );
    }
  }
  
  // If no tables were found, return the original content as pre
  if (parts.length === 0) {
    return (
      <pre className="text-xs text-gray-800 font-mono whitespace-pre-wrap overflow-auto max-h-[400px]">
        {content}
      </pre>
    );
  }
  
  return <div>{parts}</div>;
};

// Export the functions
export { processTableMarkersInErrorOutput, processTableMarkersInOutput };